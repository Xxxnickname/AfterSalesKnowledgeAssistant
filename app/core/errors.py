from __future__ import annotations

import traceback
import uuid

from fastapi import Request
from fastapi.responses import JSONResponse


def new_trace_id(prefix: str = "tr") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class AppError(Exception):
    def __init__(self, status_code: int, code, message: str, trace_id: str | None = None):
        self.status_code = status_code
        self.code = code
        self.message = message
        self.trace_id = trace_id or new_trace_id()
        super().__init__(message)


def envelope(data, *, code=0, message="ok", trace_id: str | None = None):
    return {"code": code, "message": message, "data": data, "trace_id": trace_id or new_trace_id()}


async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message, "data": None, "trace_id": exc.trace_id},
    )


async def unhandled_error_handler(request: Request, exc: Exception):
    trace_id = new_trace_id()
    if getattr(exc, "__traceback__", None):
        traceback.print_exception(exc)
    return JSONResponse(
        status_code=500,
        content={"code": 500, "message": "服务内部错误", "data": None, "trace_id": trace_id},
    )


ERROR_CODES = {
    "OK": 0,
    "PARAM_INVALID": 400,
    "UNAUTHORIZED": 401,
    "FORBIDDEN": 403,
    "NOT_FOUND": 404,
    "CONFLICT": 409,
    "RATE_LIMITED": 429,
    "INTERNAL": 500,
}
