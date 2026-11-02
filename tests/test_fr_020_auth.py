def test_fr_020_login_success(client):
    response = client.post("/api/auth/login", json={"username": "admin", "password": "Admin@12345"})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["access_token"]
    assert data["user"]["role"] == "admin"


def test_fr_020_login_failure(client):
    response = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert response.status_code == 401


def test_fr_020_users_requires_admin(client, admin_headers, agent_headers):
    assert client.get("/api/users", headers=admin_headers).status_code == 200
    response = client.get("/api/users", headers=agent_headers)
    assert response.status_code == 403
def test_cross_tenant_header_is_rejected(client, admin_headers):
    response = client.get("/api/kb/docs", headers={**admin_headers, "X-Tenant-Id": "t_other"})
    assert response.status_code == 403

