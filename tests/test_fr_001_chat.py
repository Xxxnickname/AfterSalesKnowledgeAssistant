def test_fr_001_chat_answer_with_citation(client):
    response = client.post("/api/chat", json={"message_id": "m_fr001_1", "text": "NC-500 的保修期是多久？", "images": []})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["escalated"] is False
    assert "12 个月" in data["answer"]
    assert data["citations"]
    assert data["citations"][0]["doc"]
    assert data["citations"][0]["page"] >= 1


def test_fr_008_e01_answer_has_steps_and_citation(client):
    response = client.post("/api/chat", json={"message_id": "m_fr008_1", "text": "NC-500 报 E01 怎么处理？", "images": []})
    data = response.json()["data"]
    assert data["escalated"] is False
    assert "E01" in data["answer"]
    assert data["citations"]


def test_fr_001_sse_stream(client):
    response = client.post(
        "/api/chat",
        json={"message_id": "m_sse_1", "text": "NC-500 的保修期是多久？", "images": []},
        headers={"Accept": "text/event-stream"},
    )
    assert response.status_code == 200
    assert "event: delta" in response.text
    assert "event: done" in response.text
