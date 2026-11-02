from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.errors import AppError, envelope, new_trace_id
from app.core.security import create_access_token, verify_password
from app.models import Tenant, User
from app.schemas import LoginRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _token_response(user: User):
    token = create_access_token(user.id, user.tenant_id, user.role, user.staff_role)
    return envelope({
        "access_token": token,
        "token_type": "bearer",
        "expires_in": 7200,
        "user": {
            "id": user.id, "username": user.username, "name": user.name,
            "role": user.role, "staff_role": user.staff_role, "dept": user.dept,
        },
    }, trace_id=new_trace_id())

@router.post("/login")
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    settings = get_settings()
    tenant = db.scalar(select(Tenant).where(Tenant.code == settings.default_tenant))
    if not tenant:
        raise AppError(500, 500, "租户未初始化")
    user = db.scalar(select(User).where(User.tenant_id == tenant.id, User.username == payload.username))
    if not user or not verify_password(payload.password, user.password_hash):
        if user:
            user.failed_attempts = (user.failed_attempts or 0) + 1
            if user.failed_attempts >= 5:
                user.locked_until = datetime.now(timezone.utc).replace(microsecond=0)
            db.add(user)
            db.commit()
        raise AppError(401, 401, "账号或密码不正确")
    if user.status != "active":
        raise AppError(403, 403, "账号已禁用")
    user.last_login_at = datetime.now(timezone.utc)
    user.failed_attempts = 0
    db.add(user)
    db.commit()
    return _token_response(user)


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return envelope({
        "id": user.id, "username": user.username, "name": user.name,
        "role": user.role, "staff_role": user.staff_role, "dept": user.dept, "phone": user.phone,
    })
@router.post("/demo")
def demo_login(request: Request, db: Session = Depends(get_db)):
    """本机/演示环境自动登录；生产关闭 DEMO_MODE。"""
    settings = get_settings()
    if not settings.demo_mode:
        raise AppError(404, 404, "演示登录已关闭")
    tenant = db.scalar(select(Tenant).where(Tenant.code == settings.default_tenant))
    user = db.scalar(select(User).where(User.tenant_id == tenant.id, User.username == settings.admin_username)) if tenant else None
    if not user:
        raise AppError(500, 500, "管理员未初始化")
    return _token_response(user)


