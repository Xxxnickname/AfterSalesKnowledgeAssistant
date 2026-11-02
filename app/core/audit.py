from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import AuditLog


def write_audit(db: Session, *, tenant_id: str, action: str, actor=None, object_type: str = "", object_id: str = "", result: str = "ok", trace_id: str = "", detail: dict | None = None):
    log = AuditLog(
        tenant_id=tenant_id,
        actor_id=getattr(actor, "id", None),
        actor_name=getattr(actor, "name", "system") if actor else "system",
        action=action,
        object_type=object_type,
        object_id=object_id,
        result=result,
        trace_id=trace_id,
        detail=detail or {},
    )
    db.add(log)
    return log
