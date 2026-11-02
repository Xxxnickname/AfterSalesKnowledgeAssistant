from __future__ import annotations

from types import SimpleNamespace

import httpx

from app.services import answer as answer_module


class FakeResponse:
    def __init__(self, payload=None, error=None):
        self.payload = payload or {}
        self.error = error

    def raise_for_status(self):
        if self.error:
            raise self.error

    def json(self):
        return self.payload


class FakeClient:
    def __init__(self, response):
        self.response = response

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, *args, **kwargs):
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def _patch(monkeypatch, response):
    monkeypatch.setattr(answer_module, "get_settings", lambda: SimpleNamespace(
        model_base_url="http://model.local/v1", model_api_key="test", model_name="test-model",
    ))
    monkeypatch.setattr(answer_module.httpx, "Client", lambda *args, **kwargs: FakeClient(response))


def test_model_timeout_falls_back(monkeypatch):
    _patch(monkeypatch, httpx.TimeoutException("timeout"))
    assert answer_module._model_answer("NC-500 E01", []) is None


def test_model_rate_limit_falls_back(monkeypatch):
    request = httpx.Request("POST", "http://model.local/v1/chat/completions")
    response = httpx.Response(429, request=request, text="rate limited")
    _patch(monkeypatch, FakeResponse(error=httpx.HTTPStatusError("429", request=request, response=response)))
    assert answer_module._model_answer("NC-500 E01", []) is None


def test_model_empty_response_falls_back(monkeypatch):
    _patch(monkeypatch, FakeResponse(payload={"choices": [{"message": {"content": "   "}}]}))
    assert answer_module._model_answer("NC-500 E01", []) is None

def test_redis_cache_reads_json_from_backend():
    from app.core.cache import RedisCache

    cache = RedisCache.__new__(RedisCache)
    cache._data = {}

    class FakeClient:
        def get(self, key):
            return '{"ok": true}' if key == "k" else None

    cache.client = FakeClient()
    assert cache.get_json("k") == {"ok": True}
