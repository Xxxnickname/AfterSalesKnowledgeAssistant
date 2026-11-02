from __future__ import annotations

from fastapi import Request

from .config import get_settings
from .errors import AppError
from .security import decode_access_token


def get_tenant_id(request: Request) -> str:
    header_tenant = request.headers.get("x-tenant-id")
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        try:
            payload = decode_access_token(auth.split(" ", 1)[1])
            token_tenant = payload.get("tenant_id")
            if header_tenant and token_tenant and header_tenant != token_tenant:
                raise AppError(403, 403, "租户不匹配，禁止跨租户访问")
            return token_tenant or header_tenant or get_settings().default_tenant
        except AppError:
            raise
        except Exception:
            pass
    state_tenant = getattr(request.state, "tenant_id", None)
    return header_tenant or state_tenant or get_settings().default_tenant
