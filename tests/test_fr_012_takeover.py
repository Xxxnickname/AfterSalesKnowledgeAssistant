from datetime import datetime, timezone

from app.core.db import SessionLocal
from app.models import ChatSession


def _make_waiting(session_id: str):
    with SessionLocal() as db:
        db.add(ChatSession(
            id=session_id, tenant_id="t_demo", channel="网页", customer_name="测试客户",
            customer_company="测试设备有限公司", device_model="NC-500", status="WAITING",
            queue_entered_at=datetime.now(timezone.utc), handover={"summary": "测试交接", "collected": {}, "ai_suggestion": "", "top_docs": []},
        ))
        db.commit()


def test_fr_012_takeover_conflict(client, admin_headers, agent_headers):
    _make_waiting("s_test_conflict")
    first = client.post("/api/sessions/s_test_conflict/takeover", headers=agent_headers)
    assert first.status_code == 200
    second = client.post("/api/sessions/s_test_conflict/takeover", headers=admin_headers)
    assert second.status_code == 409


def test_fr_013_concurrency_limit_five(client, admin_headers):
    for i in range(6):
        _make_waiting(f"s_test_limit_{i}")
    statuses = []
    for i in range(6):
        response = client.post(f"/api/sessions/s_test_limit_{i}/takeover", headers=admin_headers)
        statuses.append(response.status_code)
    assert 200 in statuses
    assert 409 in statuses
    admin_id = client.get("/api/auth/me", headers=admin_headers).json()["data"]["id"]
    with SessionLocal() as db:
        active = db.query(ChatSession).filter(ChatSession.status == "ACTIVE", ChatSession.assigned_agent_id == admin_id).count()
    assert active <= 5


