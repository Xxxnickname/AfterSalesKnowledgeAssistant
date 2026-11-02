from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timezone

from .config import get_settings

try:
    from argon2 import PasswordHasher
    from argon2.exceptions import VerifyMismatchError
    _PH = PasswordHasher()
except Exception:
    _PH = None
    VerifyMismatchError = Exception


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def hash_password(password: str) -> str:
    if _PH:
        return _PH.hash(password)
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return "scrypt$" + _b64(salt) + "$" + _b64(digest)


def verify_password(password: str, stored: str) -> bool:
    if not stored:
        return False
    if stored.startswith("$argon2"):
        if not _PH:
            return False
        try:
            return _PH.verify(stored, password)
        except Exception:
            return False
    if stored.startswith("scrypt$"):
        try:
            _, salt, digest = stored.split("$", 2)
            expected = _unb64(digest)
            actual = hashlib.scrypt(password.encode(), salt=_unb64(salt), n=2**14, r=8, p=1)
            return hmac.compare_digest(actual, expected)
        except Exception:
            return False
    return hmac.compare_digest(password.encode(), stored.encode())


def create_access_token(sub: str, tenant_id: str, role: str = "user", staff_role: str | None = None, expires_min: int = 120) -> str:
    now = int(time.time())
    payload = {
        "sub": sub,
        "tenant_id": tenant_id,
        "role": role,
        "staff_role": staff_role,
        "iat": now,
        "exp": now + expires_min * 60,
    }
    try:
        import jwt
        return jwt.encode(payload, get_settings().app_secret, algorithm="HS256")
    except Exception:
        body = _b64(json.dumps(payload, separators=(",", ":")).encode())
        sig = _b64(hmac.new(get_settings().app_secret.encode(), body.encode(), hashlib.sha256).digest())
        return body + "." + sig


def decode_access_token(token: str) -> dict:
    try:
        import jwt
        return jwt.decode(token, get_settings().app_secret, algorithms=["HS256"])
    except Exception:
        pass
    try:
        body, sig = token.split(".", 1)
        expected = _b64(hmac.new(get_settings().app_secret.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            raise ValueError("bad signature")
        payload = json.loads(_unb64(body))
        if int(payload.get("exp", 0)) < int(time.time()):
            raise ValueError("expired")
        return payload
    except Exception as exc:
        raise ValueError("invalid token") from exc


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
