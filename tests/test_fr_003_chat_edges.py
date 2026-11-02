def test_fr_003_idempotent_message(client):
    payload = {"message_id": "m_idem_1", "text": "NC-500 的保修期是多久？", "images": []}
    first = client.post("/api/chat", json=payload).json()["data"]
    second = client.post("/api/chat", json=payload).json()["data"]
    assert first["session_id"] == second["session_id"]
    assert first["answer"] == second["answer"]


def test_fr_009_sensitive_question_escalates(client):
    response = client.post("/api/chat", json={"message_id": "m_esc_1", "text": "你们老板电话多少", "images": []})
    data = response.json()["data"]
    assert data["escalated"] is True
    assert data["handover"]
    assert {"summary", "collected", "ai_suggestion", "top_docs"} <= set(data["handover"].keys())


def test_fr_004_image_escalates(client):
    response = client.post("/api/chat", json={"message_id": "m_img_1", "text": "看下这个报警", "images": ["data:image/png;base64,AAAA"]})
    data = response.json()["data"]
    assert data["escalated"] is True
    assert data["handover"]["reason"] == "图片需要人工确认"


def test_customer_session_detail(client):
    created = client.post("/api/chat", json={"message_id": "m_detail_1", "text": "NC-500 的保修期是多久？", "images": []}).json()["data"]
    response = client.get(f"/api/chat/session/{created['session_id']}")
    assert response.status_code == 200
    assert response.json()["data"]["messages"]
