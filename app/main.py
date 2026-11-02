from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api import admin, auth, chat, sessions
from app.core.cache import get_cache
from app.core.config import get_settings, validate_runtime_settings
from app.core.db import SessionLocal, engine, init_db, startup_lock
from app.core.errors import AppError, app_error_handler, envelope, new_trace_id, unhandled_error_handler
from app.services.seed import ensure_tenant_admin, seed_demo, seed_policy_faqs
from app.services.pdf_seed import seed_fault_cards, seed_manuals, seed_support_chunks, seed_ticket_chunks

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    validate_runtime_settings()
    with startup_lock():
        init_db()
        with SessionLocal() as db:
            if settings.seed_demo:
                seed_demo(db)
                seed_policy_faqs(db, settings.default_tenant)
                seed_manuals(db, settings.default_tenant)
                seed_ticket_chunks(db, settings.default_tenant)
                seed_support_chunks(db, settings.default_tenant)
                seed_fault_cards(db, settings.default_tenant)
            else:
                # 生产环境不导入演示业务数据，但仍需初始化租户与首个管理员。
                ensure_tenant_admin(db)
                db.commit()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)

    @app.middleware("http")
    async def tenant_middleware(request: Request, call_next):
        request.state.tenant_id = request.headers.get("x-tenant-id") or settings.default_tenant
        return await call_next(request)

    app.include_router(auth.router)
    app.include_router(chat.router)
    app.include_router(sessions.router)
    app.include_router(admin.router)

    @app.get("/health")
    @app.get("/api/health")
    def health():
        checks = {"database": "ok", "redis": "memory", "neo4j": "not_configured"}
        status = "ok"
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception as exc:
            checks["database"] = "down: " + str(exc)[:80]
            status = "degraded"
        cache = get_cache()
        if hasattr(cache, "client"):
            try:
                cache.client.ping()
                checks["redis"] = "ok"
            except Exception:
                checks["redis"] = "down"
        if settings.neo4j_uri:
            try:
                from neo4j import GraphDatabase
                driver = GraphDatabase.driver(settings.neo4j_uri, auth=(settings.neo4j_user, settings.neo4j_password))
                driver.verify_connectivity()
                driver.close()
                checks["neo4j"] = "ok"
            except Exception:
                checks["neo4j"] = "down"
        return {"status": status, "checks": checks, "trace_id": new_trace_id(), "version": "0.1.0"}

    @app.get("/api")
    def api_root():
        return envelope({"name": settings.app_name, "docs": "/docs", "health": "/health"})

    if STATIC_DIR.exists():
        app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
    return app


app = create_app()










