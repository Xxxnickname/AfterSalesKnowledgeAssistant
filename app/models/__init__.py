from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, TypeDecorator, UniqueConstraint
from sqlalchemy.types import JSON as SAJSON

from app.core.db import Base

try:
    from pgvector.sqlalchemy import Vector
except Exception:
    Vector = None


class EmbeddingType(TypeDecorator):
    impl = SAJSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql" and Vector is not None:
            return dialect.type_descriptor(Vector(384))
        return dialect.type_descriptor(SAJSON())


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:14]}"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class Tenant(Base):
    __tablename__ = "tenants"
    id = Column(String(64), primary_key=True, default=lambda: uid("t"))
    code = Column(String(64), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    status = Column(String(20), default="active", nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc, nullable=False)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("tenant_id", "username", name="uq_users_tenant_username"), Index("ix_users_tenant", "tenant_id"))
    id = Column(String(64), primary_key=True, default=lambda: uid("u"))
    tenant_id = Column(String(64), ForeignKey("tenants.id"), nullable=False)
    username = Column(String(64), nullable=False)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(64), nullable=False)
    role = Column(String(20), default="user", nullable=False)
    staff_role = Column(String(30), nullable=True)
    dept = Column(String(80), default="")
    phone = Column(String(30), default="")
    status = Column(String(20), default="active", nullable=False)
    must_change_password = Column(Boolean, default=False, nullable=False)
    failed_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc, nullable=False)


class ChatSession(Base):
    __tablename__ = "sessions"
    __table_args__ = (Index("ix_sessions_tenant_status", "tenant_id", "status"),)
    id = Column(String(64), primary_key=True, default=lambda: uid("s"))
    tenant_id = Column(String(64), ForeignKey("tenants.id"), nullable=False)
    channel = Column(String(30), default="网页", nullable=False)
    customer_name = Column(String(64), default="客户")
    customer_company = Column(String(160), default="")
    customer_phone = Column(String(40), default="")
    customer_region = Column(String(80), default="")
    customer_level = Column(String(20), default="标准")
    device_model = Column(String(40), default="")
    device_serial = Column(String(80), default="")
    status = Column(String(20), default="ACTIVE", nullable=False)
    priority = Column(String(20), default="normal")
    assigned_agent_id = Column(String(64), ForeignKey("users.id"), nullable=True)
    assigned_agent_name = Column(String(64), default="")
    handover = Column(JSON, default=dict)
    close_result = Column(String(40), nullable=True)
    queue_entered_at = Column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False)
    closed_at = Column(DateTime(timezone=True), nullable=True)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_session", "session_id", "created_at"),)
    id = Column(String(64), primary_key=True, default=lambda: uid("m"))
    tenant_id = Column(String(64), ForeignKey("tenants.id"), nullable=False)
    session_id = Column(String(64), ForeignKey("sessions.id"), nullable=False)
    external_id = Column(String(120), nullable=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, default="", nullable=False)
    msg_type = Column(String(20), default="text", nullable=False)
    citations = Column(JSON, default=list)
    created_at = Column(DateTime(timezone=True), default=now_utc, nullable=False)


class KbDoc(Base):
    __tablename__ = "kb_docs"
    __table_args__ = (UniqueConstraint("tenant_id", "name", "version", name="uq_kb_docs_version"),)
    id = Column(String(64), primary_key=True, default=lambda: uid("doc"))
    tenant_id = Column(String(64), ForeignKey("tenants.id"), nullable=False)
    name = Column(String(200), nullable=False)
    model = Column(String(40), default="全系列")
    version = Column(String(30), default="V1.0")
    doc_type = Column(String(60), default="PDF")
    size_mb = Column(Float, default=0)
    pages = Column(Integer, default=0)
    chunks_count = Column(Integer, default=0)
    parse_status = Column(String(20), default="ready")
    status = Column(String(20), default="active")
    progress = Column(Integer, default=100)
    owner = Column(String(64), default="运营")
    note = Column(String(300), default="")
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False)


class KbChunk(Base):
    __tablename__ = "kb_chunks"
    __table_args__ = (Index("ix_chunks_tenant_doc", "tenant_id", "doc_id"),)
    id = Column(String(64), primary_key=True, default=lambda: uid("chunk"))
    tenant_id = Column(String(64), ForeignKey("tenants.id"), nullable=False)
    doc_id = Column(String(64), ForeignKey("kb_docs.id"), nullable=False)
    chunk_type = Column(String(20), default="manual")
    page_no = Column(Integer, default=0)
    section_path = Column(String(200), default="")
    text = Column(Text, nullable=False)
    embedding = Column(EmbeddingType, nullable=True)
    tokens = Column(Integer, default=0)


class Faq(Base):
    __tablename__ = "faqs"
    __table_args__ = (Index("ix_faqs_tenant_status", "tenant_id", "status"),)
    id = Column(String(64), primary_key=True, default=lambda: uid("faq"))
    tenant_id = Column(String(64), ForeignKey("tenants.id"), nullable=False)
    question = Column(String(300), nullable=False)
    answer = Column(Text, nullable=False)
    category = Column(String(60), default="通用")
    product_model = Column(String(40), default="全系列")
    source_doc = Column(String(200), default="")
    source_page = Column(Integer, default=0)
    status = Column(String(20), default="published")
    hits = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=now_utc)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class Ticket(Base):
    __tablename__ = "tickets"
    id = Column(String(64), primary_key=True, default=lambda: uid("tk"))
    tenant_id = Column(String(64), ForeignKey("tenants.id"), nullable=False)
    ticket_id = Column(String(64), nullable=False)
    model = Column(String(40), default="")
    serial_no = Column(String(80), default="")
    fault_code = Column(String(40), default="")
    description = Column(Text, default="")
    resolution = Column(Text, default="")
    channel = Column(String(40), default="网页")
    satisfaction = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)


class UnmatchedQuestion(Base):
    __tablename__ = "unmatched"
    __table_args__ = (Index("ix_unmatched_tenant_count", "tenant_id", "count"),)
    id = Column(String(64), primary_key=True, default=lambda: uid("um"))
    tenant_id = Column(String(64), ForeignKey("tenants.id"), nullable=False)
    question = Column(String(300), nullable=False)
    count = Column(Integer, default=1)
    channel = Column(String(30), default="网页")
    last_seen = Column(DateTime(timezone=True), default=now_utc)
    sample_session = Column(JSON, default=dict)
    status = Column(String(20), default="new")


class Rating(Base):
    __tablename__ = "ratings"
    id = Column(String(64), primary_key=True, default=lambda: uid("rt"))
    tenant_id = Column(String(64), ForeignKey("tenants.id"), nullable=False)
    session_id = Column(String(64), ForeignKey("sessions.id"), nullable=False)
    score = Column(Integer, nullable=False)
    comment = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), default=now_utc, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_tenant_time", "tenant_id", "created_at"),)
    id = Column(String(64), primary_key=True, default=lambda: uid("au"))
    tenant_id = Column(String(64), ForeignKey("tenants.id"), nullable=False)
    actor_id = Column(String(64), nullable=True)
    actor_name = Column(String(64), default="system")
    action = Column(String(80), nullable=False)
    object_type = Column(String(40), default="")
    object_id = Column(String(80), default="")
    result = Column(String(20), default="ok")
    trace_id = Column(String(64), default="")
    detail = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), default=now_utc, nullable=False)


class AnalysisRun(Base):
    __tablename__ = "analysis_runs"
    id = Column(String(64), primary_key=True, default=lambda: uid("run"))
    tenant_id = Column(String(64), ForeignKey("tenants.id"), nullable=False)
    dataset_version = Column(String(40), default="v1")
    self_service_rate = Column(Float, default=0)
    handoff_rate = Column(Float, default=0)
    p95_ms = Column(Float, default=0)
    csat = Column(Float, default=0)
    created_at = Column(DateTime(timezone=True), default=now_utc)

