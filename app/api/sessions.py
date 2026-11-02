from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.cache import get_cache
from app.core.config import get_settings
from app.core.db import get_db
from app.core.deps import require_staff
from app.core.errors import AppError, envelope, new_trace_id
from app.core.tenant import get_tenant_id
from app.models import ChatSession, User
from app.schemas import AgentMessageRequest, CloseRequest
from app.services.sessions import add_message, fmt_time, session_to_dict, workbench_payload

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

PRESENCE_TTL = 90


def _touch(db: Session, tenant_id: str, user: User, session: ChatSession | None = None) -> datetime:
    """刷新坐席在线态；接管中的会话同时刷新 60 秒心跳。"""
    now = datetime.now(timezone.utc)
    get_cache().set(f"presence:{tenant_id}", user.id, ttl=PRESENCE_TTL)
    if session is not None:
        session.last_heartbeat_at = now
        session.updated_at = now
        db.add(session)
    return now


@router.get("")
def list_sessions(request: Request, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    _touch(db, tenant_id, user)
    db.commit()
    return envelope(workbench_payload(db, tenant_id))


@router.get("/{session_id}")
def get_session(session_id: str, request: Request, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    session = db.get(ChatSession, session_id)
    if not session or session.tenant_id != tenant_id:
        raise AppError(404, 404, "会话不存在")
    _touch(db, tenant_id, user, session if session.status == "ACTIVE" and session.assigned_agent_id == user.id else None)
    db.commit()
    return envelope(session_to_dict(db, session))


@router.post("/{session_id}/takeover")
def takeover(session_id: str, request: Request, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    session = db.get(ChatSession, session_id)
    if not session or session.tenant_id != tenant_id:
        raise AppError(404, 404, "会话不存在")
    if session.status == "CLOSED":
        raise AppError(409, 409, "会话已结束")
    if session.assigned_agent_id == user.id and session.status == "ACTIVE":
        _touch(db, tenant_id, user, session)
        db.commit()
        return envelope(session_to_dict(db, session))
    if session.assigned_agent_id and session.assigned_agent_id != user.id:
        raise AppError(409, 409, f"该会话已被 {session.assigned_agent_name or '其他坐席'} 接管")
    active_count = db.scalar(select(func.count()).select_from(ChatSession).where(
        ChatSession.tenant_id == tenant_id, ChatSession.status == "ACTIVE", ChatSession.assigned_agent_id == user.id
    )) or 0
    if active_count >= get_settings().max_concurrent:
        raise AppError(409, 409, f"已达单坐席并发上限 {get_settings().max_concurrent}")
    cache = get_cache()
    if not cache.set_nx(f"lock:session:{session_id}", user.id, ttl=90):
        raise AppError(409, 409, "该会话已被其他坐席占用，请刷新队列")
    session.status = "ACTIVE"
    session.assigned_agent_id = user.id
    session.assigned_agent_name = user.name
    session.queue_entered_at = None
    _touch(db, tenant_id, user, session)
    trace_id = new_trace_id()
    write_audit(db, tenant_id=tenant_id, action="session.takeover", actor=user, object_type="session", object_id=session.id, trace_id=trace_id)
    db.commit()
    return envelope(session_to_dict(db, session), trace_id=trace_id)


@router.post("/{session_id}/heartbeat")
def heartbeat(session_id: str, request: Request, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    session = db.get(ChatSession, session_id)
    if not session or session.tenant_id != tenant_id:
        raise AppError(404, 404, "会话不存在")
    if session.assigned_agent_id != user.id and user.role != "admin":
        raise AppError(403, 403, "该会话不属于当前坐席")
    if session.status != "ACTIVE":
        raise AppError(409, 409, "会话不在接管中")
    now = _touch(db, tenant_id, user, session)
    db.commit()
    return envelope({"session_id": session.id, "last_heartbeat_at": fmt_time(now)})


@router.post("/{session_id}/messages")
def reply(session_id: str, payload: AgentMessageRequest, request: Request, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    session = db.get(ChatSession, session_id)
    if not session or session.tenant_id != tenant_id:
        raise AppError(404, 404, "会话不存在")
    if session.assigned_agent_id != user.id and user.role != "admin":
        raise AppError(403, 403, "请先接管该会话")
    if not payload.text.strip():
        raise AppError(400, 400, "回复内容不能为空")
    add_message(db, tenant_id, session.id, "agent", payload.text.strip(), msg_type=payload.msg_type)
    _touch(db, tenant_id, user, session)
    write_audit(db, tenant_id=tenant_id, action="session.reply", actor=user, object_type="session", object_id=session.id, trace_id=new_trace_id())
    db.commit()
    return envelope(session_to_dict(db, session), trace_id=new_trace_id())


@router.post("/{session_id}/close")
def close_session(session_id: str, payload: CloseRequest, request: Request, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    session = db.get(ChatSession, session_id)
    if not session or session.tenant_id != tenant_id:
        raise AppError(404, 404, "会话不存在")
    if session.assigned_agent_id != user.id and user.role != "admin":
        raise AppError(403, 403, "请先接管该会话")
    session.status = "CLOSED"
    session.close_result = payload.result
    session.closed_at = datetime.now(timezone.utc)
    session.updated_at = datetime.now(timezone.utc)
    session.last_heartbeat_at = None
    db.add(session)
    get_cache().delete(f"lock:session:{session.id}")
    trace_id = new_trace_id()
    write_audit(db, tenant_id=tenant_id, action="session.close", actor=user, object_type="session", object_id=session.id, result="ok", trace_id=trace_id, detail={"result": payload.result})
    db.commit()
    return envelope(session_to_dict(db, session), trace_id=trace_id)
