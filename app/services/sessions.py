from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ChatSession, Message
from app.core.config import get_settings
from app.services.escalate import queue_position

TZ = ZoneInfo("Asia/Shanghai")


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def fmt_time(value: datetime | None) -> str:
    if not value:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(TZ).strftime("%Y-%m-%d %H:%M:%S")


def get_or_create_session(db: Session, tenant_id: str, session_id: str | None, *, channel: str = "网页") -> ChatSession:
    if session_id:
        existing = db.get(ChatSession, session_id)
        if existing and existing.tenant_id == tenant_id and existing.status != "CLOSED":
            if existing.updated_at and (_aware(existing.updated_at) or datetime.now(timezone.utc)) < datetime.now(timezone.utc) - timedelta(minutes=get_settings().session_ttl_min):
                existing.status = "CLOSED"
                existing.closed_at = datetime.now(timezone.utc)
                existing.updated_at = datetime.now(timezone.utc)
                db.add(existing)
                db.commit()
            else:
                return existing
    session = ChatSession(
        tenant_id=tenant_id,
        channel=channel,
        customer_name="王建国",
        customer_company="苏州恒锐精密部件有限公司",
        customer_phone="138****6721",
        customer_region="江苏 · 苏州",
        customer_level="VIP",
        device_model="NC-500",
        device_serial="NC5-2024-0917",
        status="ACTIVE",
    )
    if session_id:
        session.id = session_id
    db.add(session)
    db.flush()
    return session


def add_message(db: Session, tenant_id: str, session_id: str, role: str, content: str, *, citation: dict | None = None, msg_type: str = "text", external_id: str | None = None) -> Message:
    message = Message(
        tenant_id=tenant_id, session_id=session_id, role=role, content=content,
        msg_type=msg_type, external_id=external_id, citations=[citation] if citation else [],
    )
    db.add(message)
    db.flush()
    return message


def messages_for(db: Session, session_id: str, limit: int = 200) -> list[Message]:
    return db.scalars(select(Message).where(Message.session_id == session_id).order_by(Message.created_at.asc()).limit(limit)).all()


def message_dict(message: Message) -> dict:
    citation = (message.citations or [None])[0]
    return {
        "id": message.id,
        "role": message.role,
        "text": message.content,
        "at": fmt_time(message.created_at),
        "citation": citation,
        "msg_type": message.msg_type,
    }


def session_to_dict(db: Session, session: ChatSession, *, with_messages: bool = True) -> dict:
    messages = messages_for(db, session.id) if with_messages else []
    last = messages[-1] if messages else None
    qp = queue_position(db, session.tenant_id, session)
    return {
        "id": session.id,
        "channel": session.channel,
        "status": session.status,
        "queue_position": qp,
        "eta_min": max(1, qp + 1) if qp else 0,
        "wait_seconds": int((datetime.now(timezone.utc) - (_aware(session.queue_entered_at or session.created_at) or datetime.now(timezone.utc))).total_seconds()) if session.status == "WAITING" else 0,
        "last_message": last.content if last else "",
        "last_at": fmt_time(last.created_at if last else session.created_at),
        "locked_by": None,
        "taken_by": session.assigned_agent_name or None,
        "customer": {
            "name": session.customer_name,
            "company": session.customer_company,
            "phone": session.customer_phone,
            "region": session.customer_region,
            "level": session.customer_level,
            "tags": ["保内" if session.customer_level == "VIP" else "标准", session.device_model or "未识别"],
            "device": {
                "model": session.device_model,
                "name": "数控加工中心" if session.device_model == "NC-500" else session.device_model,
                "serial": session.device_serial,
                "purchased_at": "2025-03-18",
                "warranty_until": "2026-03-18",
            },
        },
        "handover": session.handover or {},
        "messages": [message_dict(m) for m in messages],
        "created_at": fmt_time(session.created_at),
        "closed_at": fmt_time(session.closed_at),
    }


def workbench_payload(db: Session, tenant_id: str) -> dict:
    waiting = db.scalars(select(ChatSession).where(ChatSession.tenant_id == tenant_id, ChatSession.status == "WAITING").order_by(ChatSession.queue_entered_at.asc(), ChatSession.created_at.asc())).all()
    active = db.scalars(select(ChatSession).where(ChatSession.tenant_id == tenant_id, ChatSession.status == "ACTIVE").order_by(ChatSession.updated_at.desc())).all()
    return {
        "waiting": [session_to_dict(db, s) for s in waiting],
        "active": [session_to_dict(db, s) for s in active],
    }



