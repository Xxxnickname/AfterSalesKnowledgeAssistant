from __future__ import annotations

import json
import time
from functools import lru_cache
from typing import Any

from .config import get_settings


class MemoryCache:
    def __init__(self):
        self._data: dict[str, tuple[float | None, Any]] = {}

    def _alive(self, key: str):
        item = self._data.get(key)
        if not item:
            return None
        exp, value = item
        if exp is not None and exp < time.time():
            self._data.pop(key, None)
            return None
        return value

    def get(self, key: str):
        return self._alive(key)

    def set(self, key: str, value: Any, ttl: int | None = None):
        self._data[key] = (time.time() + ttl if ttl else None, value)

    def delete(self, key: str):
        self._data.pop(key, None)

    def exists(self, key: str) -> bool:
        return self._alive(key) is not None

    def incr(self, key: str, ttl: int = 60) -> int:
        current = self._alive(key) or 0
        current = int(current) + 1
        self._data[key] = (time.time() + ttl, current)
        return current

    def set_nx(self, key: str, value: Any, ttl: int = 90) -> bool:
        if self._alive(key) is not None:
            return False
        self._data[key] = (time.time() + ttl, value)
        return True

    def get_json(self, key: str):
        raw = self._alive(key)
        return json.loads(raw) if raw else None

    def set_json(self, key: str, value: Any, ttl: int | None = None):
        self.set(key, json.dumps(value, ensure_ascii=False), ttl)


class RedisCache(MemoryCache):
    def __init__(self, url: str):
        super().__init__()
        import redis
        self.client = redis.Redis.from_url(url, decode_responses=True, socket_connect_timeout=1, socket_timeout=1)

    def get(self, key: str):
        try:
            return self.client.get(key)
        except Exception:
            return super().get(key)

    def set(self, key: str, value: Any, ttl: int | None = None):
        try:
            self.client.set(key, value, ex=ttl)
        except Exception:
            super().set(key, value, ttl)

    def delete(self, key: str):
        try:
            self.client.delete(key)
        except Exception:
            super().delete(key)

    def exists(self, key: str) -> bool:
        try:
            return bool(self.client.exists(key))
        except Exception:
            return super().exists(key)

    def get_json(self, key: str):
        # 必须从 Redis 读，否则多 worker 下幂等缓存永远命中不了。
        try:
            raw = self.client.get(key)
            return json.loads(raw) if raw else None
        except Exception:
            return super().get_json(key)

    def incr(self, key: str, ttl: int = 60) -> int:
        try:
            n = int(self.client.incr(key))
            if n == 1:
                self.client.expire(key, ttl)
            return n
        except Exception:
            return super().incr(key, ttl)

    def set_nx(self, key: str, value: Any, ttl: int = 90) -> bool:
        try:
            return bool(self.client.set(key, value, nx=True, ex=ttl))
        except Exception:
            return super().set_nx(key, value, ttl)


@lru_cache(maxsize=1)
def get_cache():
    url = get_settings().redis_url
    if url and not url.startswith("memory"):
        try:
            return RedisCache(url)
        except Exception:
            pass
    return MemoryCache()


