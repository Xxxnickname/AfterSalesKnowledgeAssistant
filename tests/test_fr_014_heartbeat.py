from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import ChatSession, Message, User
from app.worker import run_maintenance


def _agent(db):
    return db.scalar(select(User).where(User.username == "linxiao"))


def test_stale_heartbeat_returns_to_queue(client):
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        agent = _agent(db)
        session = ChatSession(
            id="s_heartbeat_stale", tenant_id=agent.tenant_id, status="ACTIVE",
            assigned_agent_id=agent.id, assigned_agent_name=agent.name,
            created_at=now - timedelta(minutes=2), updated_at=now - timedelta(minutes=2),
            last_heartbeat_at=now - timedelta(minutes=2),
        )
        db.add(session)
        db.commit()
        result = run_maintenance(db)
        db.refresh(session)
        assert result["requeued"] >= 1
        assert session.status == "WAITING"
        assert session.assigned_agent_id is None
        message = db.scalar(select(Message).where(Message.session_id == session.id, Message.role == "system"))
        assert message and "心跳超时" in message.content


def test_seeded_active_without_heartbeat_is_not_requeued(client):
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        agent = _agent(db)
        session = ChatSession(
            id="s_heartbeat_null", tenant_id=agent.tenant_id, status="ACTIVE",
            assigned_agent_id=agent.id, assigned_agent_name=agent.name,
            created_at=now, updated_at=now, last_heartbeat_at=None,
        )
        db.add(session)
        db.commit()
        run_maintenance(db)
        db.refresh(session)
        assert session.status == "ACTIVE"


def test_idle_session_is_archived(client):
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        agent = _agent(db)
        session = ChatSession(
            id="s_ttl_idle", tenant_id=agent.tenant_id, status="ACTIVE",
            created_at=now - timedelta(minutes=31), updated_at=now - timedelta(minutes=31),
        )
        db.add(session)
        db.commit()
        result = run_maintenance(db)
        db.refresh(session)
        assert result["archived"] >= 1
        assert session.status == "CLOSED"
        assert session.close_result == "timeout"


def test_offline_escalation_leaves_message(client):
    response = client.post("/api/chat", json={"message_id": "offline_1", "text": "我要转人工", "images": []})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["escalated"] is True
    assert data["handover"].get("offline_note")

