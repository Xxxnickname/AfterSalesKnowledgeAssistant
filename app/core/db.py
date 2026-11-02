from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


def _connect_args(url: str):
    if url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


@contextmanager
def startup_lock():
    """Serialize create_all + demo seed across Gunicorn workers."""
    Path("data").mkdir(parents=True, exist_ok=True)
    lock_path = Path("data/.startup.lock")
    try:
        import fcntl
        handle = lock_path.open("a+")
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            handle.close()
    except ImportError:
        yield
def build_engine(url: str | None = None):
    settings = get_settings()
    dsn = url or settings.database_url
    if dsn.startswith("sqlite:///"):
        Path("data").mkdir(parents=True, exist_ok=True)
        return create_engine(dsn, pool_pre_ping=True, future=True, connect_args=_connect_args(dsn))
    # 生产库：给慢查询兜底 15s，并限制连接池，避免单请求拖垮全站。
    return create_engine(
        dsn, pool_pre_ping=True, future=True,
        pool_size=10, max_overflow=20, pool_timeout=5, pool_recycle=1800,
        connect_args={"options": "-c statement_timeout=15000"},
    )


engine = build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, class_=Session)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from app import models  # noqa: F401
    if engine.dialect.name == "postgresql":
        try:
            with engine.begin() as conn:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        except Exception:
            pass
    Base.metadata.create_all(bind=engine)
    # create_all 不会给既有表补列；这里做一次幂等补列，兼容 SQLite/PG。
    from sqlalchemy import inspect
    columns = {column["name"] for column in inspect(engine).get_columns("sessions")}
    if "last_heartbeat_at" not in columns:
        ddl = (
            "ALTER TABLE sessions ADD COLUMN last_heartbeat_at TIMESTAMP WITH TIME ZONE"
            if engine.dialect.name == "postgresql"
            else "ALTER TABLE sessions ADD COLUMN last_heartbeat_at DATETIME"
        )
        with engine.begin() as conn:
            conn.execute(text(ddl))




