from __future__ import annotations

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.core.security import decode_access_token
from app.models import User

bearer = HTTPBearer(auto_error=False)


def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
    if not creds:
        raise AppError(401, 401, "请先登录")
    try:
        payload = decode_access_token(creds.credentials)
    except Exception:
        raise AppError(401, 401, "登录已过期，请重新登录")
    user = db.get(User, payload.get("sub"))
    if not user or user.status != "active":
        raise AppError(401, 401, "账号不存在或已禁用")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise AppError(403, 403, "需要管理员权限")
    return user


def require_staff(user: User = Depends(get_current_user)) -> User:
    if user.staff_role not in {"agent", "supervisor", "ops"} and user.role != "admin":
        raise AppError(403, 403, "需要售后坐席或运营权限")
    return user


def optional_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User | None:
    if not creds:
        return None
    try:
        payload = decode_access_token(creds.credentials)
        return db.get(User, payload.get("sub"))
    except Exception:
        return None
