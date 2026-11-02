from __future__ import annotations

import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "test.db"
os.environ.setdefault("DATABASE_URL", "sqlite:///./data/test.db")
os.environ.setdefault("SEED_DEMO", "1")
os.environ.setdefault("REDIS_URL", "memory://")
os.environ.setdefault("APP_SECRET", "test-secret")
os.environ.setdefault("ADMIN_USERNAME", "admin")
os.environ.setdefault("ADMIN_INITIAL_PASSWORD", "Admin@12345")
if DB_PATH.exists():
    DB_PATH.unlink()

from fastapi.testclient import TestClient  # noqa: E402

from app.core.cache import get_cache  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clear_memory_cache():
    cache = get_cache()
    if hasattr(cache, "_data"):
        cache._data.clear()
    yield


def _login(client: TestClient, username: str, password: str = "Admin@12345"):
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": "Bearer " + response.json()["data"]["access_token"]}


@pytest.fixture(scope="session")
def admin_headers(client):
    return _login(client, "admin")


@pytest.fixture(scope="session")
def agent_headers(client):
    return _login(client, "linxiao")
