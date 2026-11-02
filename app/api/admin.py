from __future__ import annotations

import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.db import SessionLocal, get_db
from app.core.deps import require_admin, require_staff
from app.core.errors import AppError, envelope, new_trace_id
from app.core.security import hash_password
from app.core.tenant import get_tenant_id
from app.models import AuditLog, ChatSession, Faq, KbDoc, Message, Rating, UnmatchedQuestion, User
from app.schemas import FaqDraftRequest, FeedbackRequest, UserCreate, UserUpdate
from app.services.sessions import fmt_time

router = APIRouter(prefix="/api", tags=["admin"])
ROOT = Path(__file__).resolve().parents[2]


def _doc_dict(doc: KbDoc) -> dict:
    return {
        "id": doc.id, "name": doc.name, "model": doc.model, "version": doc.version,
        "type": doc.doc_type, "size_mb": doc.size_mb, "pages": doc.pages, "chunks": doc.chunks_count,
        "parse_status": doc.parse_status, "status": doc.status, "progress": doc.progress,
        "updated_at": fmt_time(doc.updated_at), "owner": doc.owner, "note": doc.note,
    }


def _user_dict(db: Session, user: User) -> dict:
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    sessions_today = db.scalar(select(func.count()).select_from(ChatSession).where(
        ChatSession.tenant_id == user.tenant_id, ChatSession.assigned_agent_id == user.id, ChatSession.updated_at >= today
    )) or 0
    return {
        "id": user.id, "username": user.username, "name": user.name, "role": user.role,
        "staff_role": user.staff_role, "dept": user.dept, "phone": user.phone, "status": user.status,
        "last_login": fmt_time(user.last_login_at), "sessions_today": int(sessions_today),
        "created_at": fmt_time(user.created_at),
    }


def _unmatched_dict(item: UnmatchedQuestion) -> dict:
    return {
        "id": item.id, "question": item.question, "count": item.count, "last_seen": fmt_time(item.last_seen),
        "channel": item.channel, "status": item.status, "sample_session": item.sample_session or {},
    }


@router.get("/kb/docs")
def list_docs(request: Request, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    docs = db.scalars(select(KbDoc).where(KbDoc.tenant_id == tenant_id).order_by(KbDoc.updated_at.desc())).all()
    faqs = db.scalars(select(Faq).where(Faq.tenant_id == tenant_id).order_by(Faq.updated_at.desc())).all()
    return envelope({
        "docs": [_doc_dict(d) for d in docs],
        "faqs": [{
            "id": f.id, "question": f.question, "answer": f.answer, "category": f.category,
            "status": f.status, "hits": f.hits, "source": f.source_doc, "updated_at": fmt_time(f.updated_at),
        } for f in faqs],
    })


@router.post("/kb/docs/{doc_id}/reparse")
def reparse(doc_id: str, background: BackgroundTasks, request: Request, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    doc = db.get(KbDoc, doc_id)
    if not doc or doc.tenant_id != tenant_id:
        raise AppError(404, 404, "文档不存在")
    doc.parse_status = "parsing"
    doc.progress = 10
    db.add(doc)
    write_audit(db, tenant_id=tenant_id, action="kb.reparse", actor=user, object_type="kb_doc", object_id=doc.id, trace_id=new_trace_id())
    db.commit()

    def finish():
        time.sleep(2)
        with SessionLocal() as local:
            row = local.get(KbDoc, doc_id)
            if row:
                row.parse_status = "ready"
                row.progress = 100
                row.note = "重新解析完成，索引已更新"
                row.updated_at = datetime.now(timezone.utc)
                local.commit()

    background.add_task(finish)
    return envelope(_doc_dict(doc))


@router.post("/kb/docs/{doc_id}/delist")
def delist(doc_id: str, request: Request, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    doc = db.get(KbDoc, doc_id)
    if not doc or doc.tenant_id != tenant_id:
        raise AppError(404, 404, "文档不存在")
    doc.status = "offline"
    doc.note = "已人工下架，检索不再返回"
    db.add(doc)
    write_audit(db, tenant_id=tenant_id, action="kb.delist", actor=user, object_type="kb_doc", object_id=doc.id, trace_id=new_trace_id())
    db.commit()
    return envelope(_doc_dict(doc))


@router.post("/kb/docs/{doc_id}/restore")
def restore(doc_id: str, request: Request, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    doc = db.get(KbDoc, doc_id)
    if not doc or doc.tenant_id != tenant_id:
        raise AppError(404, 404, "文档不存在")
    doc.status = "active"
    doc.note = "已恢复上架"
    db.add(doc)
    write_audit(db, tenant_id=tenant_id, action="kb.restore", actor=user, object_type="kb_doc", object_id=doc.id, trace_id=new_trace_id())
    db.commit()
    return envelope(_doc_dict(doc))


@router.get("/unmatched")
def unmatched(request: Request, days: int = 7, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    since = datetime.now(timezone.utc) - timedelta(days=max(1, days))
    rows = db.scalars(select(UnmatchedQuestion).where(UnmatchedQuestion.tenant_id == tenant_id, UnmatchedQuestion.last_seen >= since).order_by(desc(UnmatchedQuestion.count))).all()
    return envelope([_unmatched_dict(r) for r in rows])


@router.post("/unmatched/{item_id}/faq-draft")
def faq_draft(item_id: str, request: Request, payload: FaqDraftRequest | None = None, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    item = db.get(UnmatchedQuestion, item_id)
    if not item or item.tenant_id != tenant_id:
        raise AppError(404, 404, "未命中问题不存在")
    question = (payload.question if payload else None) or item.question
    answer = (payload.answer if payload else None) or "【待补充】请运营根据手册补充标准答案并绑定引用。"
    category = (payload.category if payload else None) or "未命中转 FAQ"
    faq = Faq(tenant_id=tenant_id, question=question, answer=answer, category=category, status="review", source_doc=f"未命中池 {item.id}")
    db.add(faq)
    item.status = "draft"
    db.add(item)
    trace_id = new_trace_id()
    write_audit(db, tenant_id=tenant_id, action="unmatched.faq_draft", actor=user, object_type="unmatched", object_id=item.id, trace_id=trace_id)
    db.commit()
    return envelope({"id": faq.id, "question": faq.question, "status": faq.status, "source_unmatched": item.id}, trace_id=trace_id)


@router.post("/feedback")
def feedback(payload: FeedbackRequest, request: Request, db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    rating = Rating(tenant_id=tenant_id, session_id=payload.session_id, score=payload.score, comment=payload.comment)
    db.add(rating)
    write_audit(db, tenant_id=tenant_id, action="feedback.submit", object_type="session", object_id=payload.session_id, detail={"score": payload.score})
    db.commit()
    return envelope({"ok": True, "rating_id": rating.id})


@router.get("/dashboard")
def dashboard(request: Request, days: int = 14, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    demo = {}
    demo_path = ROOT / "app" / "static" / "mock" / "dashboard.json"
    if demo_path.exists():
        demo = json.loads(demo_path.read_text(encoding="utf-8"))
    rows = db.execute(select(Rating, ChatSession).join(ChatSession, ChatSession.id == Rating.session_id).where(Rating.tenant_id == tenant_id).order_by(Rating.created_at.desc()).limit(20)).all()
    negative = [{
        "id": rating.id, "session_id": rating.session_id, "customer": session.customer_name,
        "company": session.customer_company, "score": rating.score,
        "reason": "低分反馈", "comment": rating.comment, "created_at": fmt_time(rating.created_at),
        "owner": session.assigned_agent_name or "未分配", "resolved": False,
    } for rating, session in rows if rating.score <= 3]
    return envelope({
        "range": f"近 {days} 天",
        "generated_at": fmt_time(datetime.now(timezone.utc)),
        "metrics": demo.get("metrics", []),
        "trend": demo.get("trend", [])[-days:],
        "negative": negative or demo.get("negative", []),
        "total_sessions": db.scalar(select(func.count()).select_from(ChatSession).where(ChatSession.tenant_id == tenant_id)) or 0,
        "source": "db+mock_seed",
    })


@router.get("/users")
def users(request: Request, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    rows = db.scalars(select(User).where(User.tenant_id == tenant_id).order_by(User.created_at.asc())).all()
    return envelope([_user_dict(db, u) for u in rows])


@router.post("/users")
def create_user(payload: UserCreate, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    if db.scalar(select(User).where(User.tenant_id == tenant_id, User.username == payload.username)):
        raise AppError(409, 409, "账号已存在")
    if payload.role == "admin" and payload.staff_role not in (None, "supervisor", "ops"):
        raise AppError(400, 400, "管理员业务身份不合法")
    user = User(
        tenant_id=tenant_id, username=payload.username, password_hash=hash_password(payload.password or "Hr@2026#4821"),
        name=payload.name, role=payload.role, staff_role=payload.staff_role, dept=payload.dept, phone=payload.phone,
    )
    db.add(user)
    write_audit(db, tenant_id=tenant_id, action="user.create", actor=admin, object_type="user", object_id=user.id, trace_id=new_trace_id())
    db.commit()
    return envelope(_user_dict(db, user))


@router.patch("/users/{user_id}")
def update_user(user_id: str, payload: UserUpdate, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    user = db.get(User, user_id)
    if not user or user.tenant_id != tenant_id:
        raise AppError(404, 404, "账号不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(user, key, value)
    db.add(user)
    write_audit(db, tenant_id=tenant_id, action="user.update", actor=admin, object_type="user", object_id=user.id, trace_id=new_trace_id())
    db.commit()
    return envelope(_user_dict(db, user))


@router.post("/users/{user_id}/reset-password")
def reset_password(user_id: str, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    user = db.get(User, user_id)
    if not user or user.tenant_id != tenant_id:
        raise AppError(404, 404, "账号不存在")
    temp = "Hr@2026#" + str(secrets.randbelow(9000) + 1000)
    user.password_hash = hash_password(temp)
    user.must_change_password = True
    db.add(user)
    write_audit(db, tenant_id=tenant_id, action="user.reset_password", actor=admin, object_type="user", object_id=user.id, trace_id=new_trace_id())
    db.commit()
    return envelope({"temp_password": temp})


@router.get("/qc/sessions")
def qc_sessions(request: Request, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    tenant_id = get_tenant_id(request)
    sessions = db.scalars(select(ChatSession).where(ChatSession.tenant_id == tenant_id, ChatSession.status == "CLOSED").order_by(desc(ChatSession.updated_at)).limit(30)).all()
    result = []
    for s in sessions:
        rating = db.scalar(select(Rating).where(Rating.session_id == s.id).order_by(desc(Rating.created_at)))
        messages = db.scalars(select(Message).where(Message.session_id == s.id).order_by(Message.created_at.asc())).all()
        result.append({
            "id": "qc_" + s.id, "session_id": s.id, "customer": s.customer_name, "company": s.customer_company,
            "agent": s.assigned_agent_name or "未分配", "channel": s.channel, "score": rating.score if rating else 3,
            "status": "reviewed" if rating else "pending", "issue_type": None, "flags": [],
            "duration_sec": 0, "started_at": fmt_time(s.created_at), "trace_id": "tr_backend",
            "messages": [{"role": m.role, "text": m.content, "at": fmt_time(m.created_at), "citation": (m.citations or [None])[0]} for m in messages],
            "citations": [], "actions": [],
        })
    return envelope(result)


@router.get("/audit")
def audit_logs(request: Request, limit: int = 50, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.scalars(select(AuditLog).where(AuditLog.tenant_id == get_tenant_id(request)).order_by(desc(AuditLog.created_at)).limit(limit)).all()
    return envelope([{
        "id": a.id, "actor": a.actor_name, "action": a.action, "object_type": a.object_type,
        "object_id": a.object_id, "result": a.result, "trace_id": a.trace_id, "at": fmt_time(a.created_at),
    } for a in rows])
@router.get("/kb/glossary")
def glossary(request: Request, user: User = Depends(require_staff)):
    demo_path = ROOT / "app" / "static" / "mock" / "kb_docs.json"
    if demo_path.exists():
        payload = json.loads(demo_path.read_text(encoding="utf-8"))
        return envelope(payload.get("glossary", []))
    return envelope([])

