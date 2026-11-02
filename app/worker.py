from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.cache import get_cache
from app.core.config import get_settings
from app.core.db import SessionLocal, init_db
from app.models import ChatSession, KbDoc
from app.services.sessions import add_message


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def run_maintenance(db) -> dict:
    """心跳超时回队列 + 30 分钟无消息自动归档。返回本轮处理数量，便于脚本断言。"""
    now = datetime.now(timezone.utc)
    settings = get_settings()
    cache = get_cache()
    requeued = 0
    archived = 0

    heartbeat_cutoff = now - timedelta(seconds=settings.heartbeat_timeout_sec)
    stale = db.scalars(select(ChatSession).where(
        ChatSession.status == "ACTIVE",
        ChatSession.last_heartbeat_at.is_not(None),
        ChatSession.last_heartbeat_at < heartbeat_cutoff,
    )).all()
    for session in stale:
        session.status = "WAITING"
        session.assigned_agent_id = None
        session.assigned_agent_name = ""
        session.queue_entered_at = now
        session.updated_at = now
        session.last_heartbeat_at = None
        add_message(db, session.tenant_id, session.id, "system", "坐席心跳超时，会话已自动回到待接入队列。")
        db.add(session)
        cache.delete(f"lock:session:{session.id}")
        requeued += 1

    ttl_cutoff = now - timedelta(minutes=settings.session_ttl_min)
    idle = db.scalars(select(ChatSession).where(
        ChatSession.status != "CLOSED",
        ChatSession.updated_at < ttl_cutoff,
    )).all()
    for session in idle:
        session.status = "CLOSED"
        session.close_result = "timeout"
        session.closed_at = now
        session.updated_at = now
        add_message(db, session.tenant_id, session.id, "system", f"会话超过 {settings.session_ttl_min} 分钟无新消息，已自动结束。")
        db.add(session)
        cache.delete(f"lock:session:{session.id}")
        archived += 1

    if requeued or archived:
        db.commit()
    return {"requeued": requeued, "archived": archived}


def run_parse_tick(db) -> int:
    rows = db.scalars(select(KbDoc).where(KbDoc.parse_status == "parsing")).all()
    for doc in rows:
        if doc.progress < 100:
            doc.progress = min(100, (doc.progress or 0) + 10)
        if doc.progress >= 100:
            doc.parse_status = "ready"
            doc.note = "异步解析完成，索引已更新"
        db.add(doc)
    if rows:
        db.commit()
    return len(rows)


def main():
    init_db()
    print("maintenance worker started", flush=True)
    while True:
        try:
            with SessionLocal() as db:
                result = run_maintenance(db)
                parsed = run_parse_tick(db)
                if result["requeued"] or result["archived"] or parsed:
                    print(f"maintenance {result} parsed={parsed}", flush=True)
        except Exception as exc:
            print("worker error:", exc, flush=True)
        time.sleep(3)


if __name__ == "__main__":
    main()
