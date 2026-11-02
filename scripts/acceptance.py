from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime

import httpx

BASE = os.getenv("ACCEPTANCE_BASE_URL", "http://127.0.0.1:8001")
results = []


def check(name: str, ok: bool, detail: str = ""):
    results.append((name, bool(ok), detail))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--out", default="reports/acceptance.md")
    args = parser.parse_args()
    client = httpx.Client(base_url=BASE, timeout=20)
    try:
        health = client.get("/health")
        check("health", health.status_code == 200 and health.json().get("status") == "ok", health.text[:120])
        login = client.post("/api/auth/login", json={"username": "admin", "password": os.getenv("ADMIN_INITIAL_PASSWORD", "Admin@12345")})
        token = login.json()["data"]["access_token"] if login.status_code == 200 else ""
        check("admin login", login.status_code == 200, f"status={login.status_code} token_len={len(token)}")
        headers = {"Authorization": "Bearer " + token}
        chat = client.post("/api/chat", json={"message_id": "acc_1", "text": "NC-500 的保修期是多久？", "images": []})
        data = chat.json().get("data", {}) if chat.status_code == 200 else {}
        check("chat citation", chat.status_code == 200 and "12 个月" in data.get("answer", "") and bool(data.get("citations")), str(data)[:180])
        e01 = client.post("/api/chat", json={"message_id": "acc_2", "text": "NC-500 报 E01 怎么处理？", "images": []})
        e01_data = e01.json().get("data", {}) if e01.status_code == 200 else {}
        check("E01 cited answer", e01.status_code == 200 and "E01" in e01_data.get("answer", "") and bool(e01_data.get("citations")), str(e01_data)[:180])
        esc = client.post("/api/chat", json={"message_id": "acc_3", "text": "你们老板电话多少", "images": []})
        esc_data = esc.json().get("data", {}) if esc.status_code == 200 else {}
        check("escalation handover", esc_data.get("escalated") is True and bool(esc_data.get("handover")), str(esc_data.get("handover", {}))[:180])
        sessions = client.get("/api/sessions", headers=headers)
        payload = sessions.json().get("data", {}) if sessions.status_code == 200 else {}
        check("workbench queue", sessions.status_code == 200 and "waiting" in payload and "active" in payload, f"waiting={len(payload.get('waiting', []))}")
        docs = client.get("/api/kb/docs", headers=headers)
        check("kb docs", docs.status_code == 200 and len(docs.json().get("data", {}).get("docs", [])) >= 3, docs.text[:120])
        unmatched = client.get("/api/unmatched?days=30", headers=headers)
        rows = unmatched.json().get("data", []) if unmatched.status_code == 200 else []
        check("unmatched sorted", unmatched.status_code == 200 and rows == sorted(rows, key=lambda x: x.get("count", 0), reverse=True), f"rows={len(rows)}")
        dashboard = client.get("/api/dashboard", headers=headers)
        check("dashboard", dashboard.status_code == 200 and "metrics" in dashboard.json().get("data", {}), dashboard.text[:120])
    except Exception as exc:
        check("acceptance runner", False, repr(exc))
    finally:
        client.close()

    lines = ["# 验收记录", "", f"- 时间：{datetime.now().isoformat(timespec='seconds')}", f"- 服务：{BASE}", "", "| 检查 | 结果 | 详情 |", "|---|---|---|"]
    for name, ok, detail in results:
        lines.append(f"| {name} | {'PASS' if ok else 'FAIL'} | {detail.replace('|', '/')} |")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    sys.exit(0 if all(ok for _, ok, _ in results) else 1)


if __name__ == "__main__":
    main()


