from __future__ import annotations

import csv
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.models import AnalysisRun, ChatSession, Faq, KbChunk, KbDoc, Message, Rating, Tenant, Ticket, UnmatchedQuestion, User
from app.services.embeddings import hash_embedding, normalize, tokenize
from app.services.sessions import fmt_time

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "samples" / "01"
MOCK = ROOT / "app" / "static" / "mock"


def _load_json(name: str):
    path = MOCK / name
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def _dt(value: str | None):
    if not value:
        return datetime.now(timezone.utc)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def ensure_tenant_admin(db: Session) -> tuple[Tenant, User]:
    settings = get_settings()
    tenant = db.scalar(select(Tenant).where(Tenant.code == settings.default_tenant))
    if not tenant:
        tenant = Tenant(id=settings.default_tenant, code=settings.default_tenant, name=settings.tenant_name)
        db.add(tenant)
        db.flush()
    admin = db.scalar(select(User).where(User.tenant_id == tenant.id, User.username == settings.admin_username))
    if not admin:
        admin = User(
            tenant_id=tenant.id, username=settings.admin_username, password_hash=hash_password(settings.admin_password),
            name="系统管理员", role="admin", staff_role="supervisor", dept="系统管理部", phone="138****0001",
        )
        db.add(admin)
        db.flush()
    return tenant, admin


def seed_demo(db: Session) -> None:
    settings = get_settings()
    tenant, admin = ensure_tenant_admin(db)
    if db.scalar(select(func.count()).select_from(Faq).where(Faq.tenant_id == tenant.id)):
        return

    password = settings.admin_password
    pwd_hash = hash_password(password)
    users_doc = _load_json("users.json") or {"users": []}
    name_to_user: dict[str, User] = {admin.name: admin}
    for item in users_doc.get("users", []):
        if item.get("username") == settings.admin_username:
            name_to_user[item["name"]] = admin
            continue
        user = db.scalar(select(User).where(User.tenant_id == tenant.id, User.username == item["username"]))
        if not user:
            user = User(
                tenant_id=tenant.id, username=item["username"], password_hash=pwd_hash, name=item["name"],
                role=item.get("role", "user"), staff_role=item.get("staff_role"), dept=item.get("dept", ""),
                phone=item.get("phone", ""), status=item.get("status", "active"),
            )
            db.add(user)
            db.flush()
        name_to_user[item["name"]] = user

    docs_doc = _load_json("kb_docs.json") or {}
    docs: dict[str, KbDoc] = {}
    for item in docs_doc.get("docs", []):
        doc = KbDoc(
            id=item.get("id"), tenant_id=tenant.id, name=item["name"], model=item.get("model", "全系列"),
            version=item.get("version", "V1.0"), doc_type=item.get("type", "PDF"), size_mb=item.get("size_mb", 0),
            pages=item.get("pages", 0), chunks_count=item.get("chunks", 0), parse_status=item.get("parse_status", "ready"),
            status=item.get("status", "active"), progress=item.get("progress", 100), owner=item.get("owner", "运营"),
            note=item.get("note", ""), updated_at=_dt(item.get("updated_at")),
        )
        db.add(doc)
        docs[doc.name] = doc
    db.flush()

    chat_faq = _load_json("chat_faq.json") or {}
    for faq in chat_faq.get("faqs", []):
        for citation in faq.get("citations", []):
            doc = docs.get(citation.get("doc"))
            if not doc:
                doc = KbDoc(tenant_id=tenant.id, name=citation.get("doc") or "售后知识库", model="全系列", version="演示", note="由 FAQ 引用补齐")
                db.add(doc)
                db.flush()
                docs[doc.name] = doc
            text = citation.get("excerpt") or faq.get("answer", "")
            chunk = KbChunk(
                tenant_id=tenant.id, doc_id=doc.id, page_no=int(citation.get("page") or 0),
                section_path=citation.get("section") or "", text=text, embedding=hash_embedding(text), tokens=len(tokenize(text)),
            )
            db.add(chunk)

    faq_path = SAMPLES / "faq.csv"
    seen_faq = set()
    if faq_path.exists():
        with faq_path.open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                key = normalize(row.get("question", ""))
                if key in seen_faq:
                    continue
                seen_faq.add(key)
                db.add(Faq(
                    id=row.get("faq_id") or None, tenant_id=tenant.id, question=row["question"], answer=row["answer"],
                    category=row.get("category", "通用"), product_model=row.get("product_model", "全系列"),
                    source_doc=row.get("source_doc", ""), source_page=int(row.get("source_page") or 0),
                    status="published", hits=0,
                ))

    # 样例 FAQ 只覆盖 NC-500，这里补齐同政策的 CV/PK 保修 FAQ。
    for model in ("CV-800", "PK-1200"):
        exists = db.scalar(select(Faq).where(Faq.tenant_id == tenant.id, Faq.question.like(f"{model}%保修%")))
        if not exists:
            db.add(Faq(
                tenant_id=tenant.id, question=f"{model} 的保修期是多久？",
                answer="整机保修 12 个月，核心部件（主轴、伺服、控制器）18 个月，易损件 3 个月；以出厂编号与发票日期为准。",
                category="售后政策", product_model=model,
                source_doc="恒锐精工售后服务政策", source_page=3, status="published",
            ))
    wb = _load_json("workbench_sessions.json") or {"waiting": [], "active": []}
    # 演示会话锚定到“刚刚”，否则上线后会被 30 分钟 TTL 立即归档。
    stamps = []
    for kind in ("waiting", "active"):
        for item in wb.get(kind, []):
            if item.get("last_at"):
                stamps.append(_dt(item.get("last_at")))
            stamps.extend(_dt(msg.get("at")) for msg in item.get("messages", []) if msg.get("at"))
    anchor = max(stamps) if stamps else datetime.now(timezone.utc)
    span = (anchor - min(stamps)).total_seconds() if stamps else 0
    scale = min(1.0, 18 * 60 / span) if span else 1.0
    newest = datetime.now(timezone.utc) - timedelta(minutes=3)

    def _recent(value):
        # 保留先后顺序，同时把整体跨度压到 18 分钟内，避免演示数据被 TTL 立即归档。
        return newest - (anchor - _dt(value)) * scale if value else newest

    for kind in ("waiting", "active"):
        for item in wb.get(kind, []):
            customer = item.get("customer", {})
            device = customer.get("device", {})
            created = _recent(item.get("last_at"))
            queue_at = created - timedelta(seconds=int(item.get("wait_seconds") or 0))
            agent_name = item.get("taken_by") or ""
            agent = name_to_user.get(agent_name)
            session = ChatSession(
                id=item["id"], tenant_id=tenant.id, channel=item.get("channel", "网页"),
                customer_name=customer.get("name", "客户"), customer_company=customer.get("company", ""),
                customer_phone=customer.get("phone", ""), customer_region=customer.get("region", ""),
                customer_level=customer.get("level", "标准"), device_model=device.get("model", ""),
                device_serial=device.get("serial", ""), status=item.get("status", "WAITING"),
                assigned_agent_id=agent.id if agent else None, assigned_agent_name=agent_name,
                handover=item.get("handover", {}), queue_entered_at=queue_at,
                created_at=queue_at, updated_at=created,
            )
            db.add(session)
            for msg in item.get("messages", []):
                db.add(Message(
                    tenant_id=tenant.id, session_id=session.id, external_id=msg.get("id"), role=msg.get("role", "customer"),
                    content=msg.get("text", ""), citations=[msg["citation"]] if msg.get("citation") else [], created_at=_recent(msg.get("at")),
                ))

    unmatched = _load_json("unmatched.json") or []
    for item in unmatched:
        db.add(UnmatchedQuestion(
            id=item.get("id"), tenant_id=tenant.id, question=item.get("question", ""), count=item.get("count", 1),
            channel=item.get("channel", "网页"), last_seen=_recent(item.get("last_seen")), sample_session=item.get("sample_session", {}),
            status=item.get("status", "new"),
        ))

    dashboard = _load_json("dashboard.json") or {}
    for item in dashboard.get("negative", []):
        if not db.get(ChatSession, item.get("session_id")):
            db.add(ChatSession(
                id=item.get("session_id"), tenant_id=tenant.id, channel="网页", customer_name=item.get("customer", "客户"),
                customer_company=item.get("company", ""), status="CLOSED", closed_at=_dt(item.get("created_at")),
                created_at=_dt(item.get("created_at")),
            ))
        db.add(Rating(tenant_id=tenant.id, session_id=item.get("session_id"), score=item.get("score", 3), comment=item.get("comment", ""), created_at=_dt(item.get("created_at"))))

    ticket_path = SAMPLES / "tickets.csv"
    if ticket_path.exists():
        with ticket_path.open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                db.add(Ticket(
                    tenant_id=tenant.id, ticket_id=row.get("ticket_id", ""), model=row.get("product_model", ""),
                    serial_no=row.get("serial_no", ""), fault_code=row.get("fault_code", ""),
                    description=row.get("description", ""), resolution=row.get("resolution", ""), channel=row.get("channel", ""),
                    satisfaction=int(row["satisfaction"]) if row.get("satisfaction") else None, created_at=_dt(row.get("created_at")),
                ))

    db.add(AnalysisRun(
        tenant_id=tenant.id, dataset_version="demo-v1",
        self_service_rate=float(dashboard.get("metrics", [{}])[0].get("value", 0) or 0),
        handoff_rate=float(dashboard.get("metrics", [{}, {}])[1].get("value", 0) or 0),
        p95_ms=1420, csat=4.62,
    ))
    db.commit()
def seed_policy_faqs(db: Session, tenant_id: str) -> int:
    added = 0
    for model in ("CV-800", "PK-1200"):
        exists = db.scalar(select(Faq).where(Faq.tenant_id == tenant_id, Faq.question.like(f"{model}%保修%")))
        if not exists:
            db.add(Faq(
                tenant_id=tenant_id, question=f"{model} 的保修期是多久？",
                answer="整机保修 12 个月，核心部件（主轴、伺服、控制器）18 个月，易损件 3 个月；以出厂编号与发票日期为准。",
                category="售后政策", product_model=model,
                source_doc="恒锐精工售后服务政策", source_page=3, status="published",
            ))
            added += 1
    db.commit()
    return added



