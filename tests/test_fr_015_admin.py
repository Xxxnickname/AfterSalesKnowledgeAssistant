def test_fr_015_unmatched_sorted_and_draft(client, admin_headers):
    response = client.get("/api/unmatched?days=30", headers=admin_headers)
    assert response.status_code == 200
    rows = response.json()["data"]
    assert rows
    counts = [r["count"] for r in rows]
    assert counts == sorted(counts, reverse=True)
    draft = client.post(f"/api/unmatched/{rows[0]['id']}/faq-draft", headers=admin_headers, json={"answer": "先停机检查滤网与冷却风道，空载复测。"})
    assert draft.status_code == 200
    assert draft.json()["data"]["status"] == "review"


def test_fr_016_docs_delist_restore(client, admin_headers):
    docs = client.get("/api/kb/docs", headers=admin_headers).json()["data"]["docs"]
    assert len(docs) >= 3
    doc_id = docs[0]["id"]
    assert client.post(f"/api/kb/docs/{doc_id}/delist", headers=admin_headers).status_code == 200
    assert client.post(f"/api/kb/docs/{doc_id}/restore", headers=admin_headers).status_code == 200


def test_fr_018_feedback_and_dashboard(client, admin_headers):
    response = client.post("/api/feedback", json={"session_id": "s_20261031_0179", "score": 2, "comment": "测试差评"})
    assert response.status_code == 200
    dashboard = client.get("/api/dashboard", headers=admin_headers)
    assert dashboard.status_code == 200
    assert "negative" in dashboard.json()["data"]


def test_fr_021_audit_after_admin_action(client, admin_headers):
    rows = client.get("/api/audit?limit=20", headers=admin_headers)
    assert rows.status_code == 200
    assert isinstance(rows.json()["data"], list)


def test_fr_005_rate_limit(client):
    from app.core.cache import get_cache
    cache = get_cache()
    if hasattr(cache, "_data"):
        cache._data.clear()
    statuses = []
    for i in range(21):
        response = client.post("/api/chat", json={"message_id": f"m_rate_{i}", "text": "NC-500 的保修期是多久？", "images": []})
        statuses.append(response.status_code)
    assert 429 in statuses
