from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.cache import get_cache
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import AppError, envelope, new_trace_id
from app.core.tenant import get_tenant_id
from app.schemas import ChatRequest, EscalateRequest
from app.services.answer import answer_question
from app.services.escalate import escalate, queue_position
from app.services.sessions import add_message, get_or_create_session, messages_for, session_to_dict

router = APIRouter(prefix="/api", tags=["chat"])


def _rate_limit(request: Request):
    settings = get_settings()
    ip = request.client.host if request.client else "unknown"
    bucket = int(time.time() // 60)
    count = get_cache().incr(f"rate:{ip}:{bucket}", ttl=70)
    if count > settings.rate_limit_per_min:
        raise AppError(429, 429, "请求过于频繁，请稍后再试")


def _sse(event: str, payload: dict) -> str:
    return "event: " + event + "\n" + "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"


def _run_chat(db: Session, tenant_id: str, payload: ChatRequest, request: Request) -> dict:
    if not payload.text.strip() and not payload.images:
        raise AppError(400, 400, "消息不能为空")
    if len(payload.images) > 3:
        raise AppError(400, 400, "一次最多上传 3 张图片")
    for image in payload.images:
        if not str(image).startswith("data:image/"):
            raise AppError(400, 400, "图片格式不支持，请上传 JPG/PNG/WEBP")
        if len(str(image)) > 12 * 1024 * 1024:
            raise AppError(413, 413, "单张图片不能超过 8MB")
    _rate_limit(request)
    cache = get_cache()
    cache_key = f"idem:{tenant_id}:{payload.message_id}"
    cached = cache.get_json(cache_key)
    if cached:
        return cached

    session = get_or_create_session(db, tenant_id, payload.session_id)
    history = messages_for(db, session.id)
    add_message(db, tenant_id, session.id, "customer", payload.text or "[图片]", msg_type="image" if payload.images else "text", external_id=payload.message_id)
    result = answer_question(db, tenant_id, payload.text, has_images=bool(payload.images), history=history)

    citation_payload = result.citations[0] if result.citations else None
    add_message(db, tenant_id, session.id, "ai", result.answer, citation=citation_payload)
    escalated = False
    handover = None
    if result.escalate:
        handover = escalate(db, tenant_id, session, question=payload.text, answer=result.answer, candidates=result.candidates, reason=result.reason)
        offline = not cache.exists(f"presence:{tenant_id}")
        if offline:
            handover = {**handover, "offline_note": "当前坐席不在线，已记录留言，售后会在工作时间内联系你。"}
            session.handover = handover
            add_message(db, tenant_id, session.id, "system", handover["offline_note"])
        else:
            add_message(db, tenant_id, session.id, "system", f"已转人工：{result.reason}")
        escalated = True
    session.updated_at = datetime.now(timezone.utc)
    db.add(session)
    db.commit()

    trace_id = new_trace_id()
    response = {
        "session_id": session.id,
        "message_id": "m_" + payload.message_id,
        "answer": result.answer,
        "citations": result.citations,
        "escalated": escalated,
        "handover": handover,
        "trace_id": trace_id,
        "session": session_to_dict(db, session, with_messages=False),
    }
    cache.set_json(cache_key, response, ttl=3600)
    return response


@router.post("/chat")
def chat(payload: ChatRequest, request: Request, db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    response = _run_chat(db, tenant_id, payload, request)
    wants_sse = "text/event-stream" in request.headers.get("accept", "")
    if not wants_sse:
        return envelope(response, trace_id=response["trace_id"])

    def stream():
        yield _sse("delta", {"text": response["answer"]})
        for citation in response["citations"]:
            yield _sse("citation", citation)
        yield _sse("done", {
            "message_id": response["message_id"],
            "escalated": response["escalated"],
            "trace_id": response["trace_id"],
        })

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/chat/session/{session_id}")
def chat_session(session_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    from app.models import ChatSession
    session = db.get(ChatSession, session_id)
    if not session or session.tenant_id != tenant_id:
        raise AppError(404, 404, "会话不存在")
    return envelope(session_to_dict(db, session))
@router.get("/chat/faqs")
def chat_faqs(request: Request, db: Session = Depends(get_db)):
    from sqlalchemy import select
    from app.models import Faq
    tenant_id = get_tenant_id(request)
    quick = [
        "NC-500 报 E01 怎么处理？",
        "NC-500 的保修期是多久？",
        "PT-800 打标位置偏移怎么校准？",
        "如何申请上门维修？",
    ]
    return envelope({
        "greeting": "你好，我是恒锐精工售后助手。可以描述设备型号与报警代码，我会按手册给出处理步骤并标注出处；拿不准的问题会直接转人工同事。",
        "quick_questions": quick,
    })


@router.post("/chat/escalate")
def request_escalation(payload: EscalateRequest, request: Request, db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    session = get_or_create_session(db, tenant_id, payload.session_id)
    if session.status != "WAITING":
        escalate(db, tenant_id, session, question="客户要求转人工", answer="", candidates=[], reason=payload.reason or "客户要求转人工")
        add_message(db, tenant_id, session.id, "system", f"已转人工：{payload.reason or '客户要求转人工'}")
        db.commit()
    qp = queue_position(db, tenant_id, session)
    return envelope({
        "session_id": session.id,
        "queue_position": qp,
        "eta_min": max(1, qp + 1) if qp else 0,
        "handover": session.handover or {},
        "assigned_team": "售后队列",
        "business_hours": "09:00–21:00",
        "reason": payload.reason,
    })




