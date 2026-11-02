from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from datetime import datetime

import httpx

BASE = os.getenv("ACCEPTANCE_BASE_URL", "http://127.0.0.1:8001")
PROJECT = "kb"
rows: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str):
    rows.append((name, "PASS" if ok else "FAIL", detail.replace("|", "/").replace("\n", " ")[:200]))


def docker(*args: str, timeout: int = 60):
    return subprocess.run(["docker", "compose", "-p", PROJECT, *args], capture_output=True,
                          text=True, encoding="utf-8", errors="replace", timeout=timeout)


def main() -> int:
    client = httpx.Client(base_url=BASE, timeout=30)
    created_sessions: list[str] = []
    run_id = uuid.uuid4().hex[:8]
    try:
        health = client.get("/health")
        check("服务健康", health.status_code == 200 and health.json().get("status") == "ok", health.text[:150])

        pages = ["/", "/#/chat", "/#/workbench", "/#/unmatched", "/#/kb", "/#/dashboard", "/#/qc", "/#/users"]
        page_results = [client.get(path.split("#")[0] or "/").status_code for path in pages]
        check("8 屏静态入口", all(code == 200 for code in page_results), f"codes={page_results}")

        login = client.post("/api/auth/login", json={"username": "admin", "password": "Admin@12345"})
        token = login.json().get("data", {}).get("access_token") if login.status_code == 200 else ""
        headers = {"Authorization": "Bearer " + token}
        check("管理员登录", login.status_code == 200 and bool(token), f"status={login.status_code}")

        sessions = client.get("/api/sessions", headers=headers)
        payload = sessions.json().get("data", {}) if sessions.status_code == 200 else {}
        check("工作台队列", sessions.status_code == 200 and "waiting" in payload and "active" in payload,
              f"waiting={len(payload.get('waiting', []))} active={len(payload.get('active', []))}")


        chat = client.post("/api/chat", json={"message_id": f"dod_chat_{run_id}", "text": "NC-500 的保修期是多久？", "images": []})
        chat_data = chat.json().get("data", {}) if chat.status_code == 200 else {}
        if chat_data.get("session_id"):
            created_sessions.append(chat_data["session_id"])
        check("聊天引用", chat.status_code == 200 and "12 个月" in chat_data.get("answer", "") and bool(chat_data.get("citations")),
              f"status={chat.status_code} citations={len(chat_data.get('citations', []))}")

        esc = client.post("/api/chat", json={"message_id": f"dod_esc_{run_id}", "text": "我要转人工", "images": []})
        esc_data = esc.json().get("data", {}) if esc.status_code == 200 else {}
        if esc_data.get("session_id"):
            created_sessions.append(esc_data["session_id"])
        handover = esc_data.get("handover") or {}
        four = all(key in handover for key in ("summary", "collected", "ai_suggestion", "top_docs"))
        check("转人工交接包 4 段", esc_data.get("escalated") is True and four, f"keys={list(handover)[:6]}")


        docs = client.get("/api/kb/docs", headers=headers)
        check("知识库文档", docs.status_code == 200 and len(docs.json().get("data", {}).get("docs", [])) >= 3, docs.text[:120])
        unmatched = client.get("/api/unmatched?days=30", headers=headers)
        rows_unmatched = unmatched.json().get("data", []) if unmatched.status_code == 200 else []
        check("未命中池排序", unmatched.status_code == 200 and rows_unmatched == sorted(rows_unmatched, key=lambda x: x.get("count", 0), reverse=True),
              f"rows={len(rows_unmatched)}")
        dashboard = client.get("/api/dashboard", headers=headers)
        check("指标看板", dashboard.status_code == 200 and "metrics" in dashboard.json().get("data", {}), dashboard.text[:120])
        users = client.get("/api/users", headers=headers)
        check("用户管理", users.status_code == 200 and bool(users.json().get("data", [])), users.text[:120])
        qc = client.get("/api/qc/sessions", headers=headers)
        qc_data = qc.json().get("data", []) if qc.status_code == 200 else []
        check("会话质检", qc.status_code == 200 and isinstance(qc_data, list) and bool(qc_data), f"rows={len(qc_data)}")
        esc_session = esc_data.get("session_id")
        if esc_session:
            client.post(f"/api/sessions/{esc_session}/takeover", headers=headers)
        audit = client.get("/api/audit", headers=headers)
        audit_rows = audit.json().get("data", []) if audit.status_code == 200 else []
        audited = any(row.get("object_id") == esc_session for row in audit_rows)
        check("审计日志", audit.status_code == 200 and audited, f"rows={len(audit_rows)} session_audited={audited}")

        vector = docker("exec", "-T", "db", "psql", "-U", "kb", "-d", "kb", "-t", "-A", "-c",
                        "select extversion from pg_extension where extname='vector';")
        column = docker("exec", "-T", "db", "psql", "-U", "kb", "-d", "kb", "-t", "-A", "-c",
                        "select udt_name from information_schema.columns where table_name='kb_chunks' and column_name='embedding';")
        check("pgvector", "0.7" in (vector.stdout or "") and "vector" in (column.stdout or ""),
              f"version={(vector.stdout or '').strip()} type={(column.stdout or '').strip()}")

        ps = docker("ps", timeout=30)
        running = [line for line in (ps.stdout or "").splitlines() if "running" in line.lower() or "healthy" in line.lower()]
        check("Compose 五服务", all(name in (ps.stdout or "") for name in ("kb-app-1", "kb-db-1", "kb-redis-1", "kb-neo4j-1", "kb-worker-1")),
              f"running_lines={len(running)}")

        pytest_run = subprocess.run([sys.executable, "-m", "pytest", "-q"], capture_output=True, text=True,
                                    encoding="utf-8", errors="replace", timeout=120)
        tail = ((pytest_run.stdout or "") + (pytest_run.stderr or "")).strip().splitlines()[-1:] or [""]
        check("自动化测试", pytest_run.returncode == 0, tail[0])

        eval_text = open("reports/eval.md", encoding="utf-8").read() if os.path.exists("reports/eval.md") else ""
        check("全量评测 120/120", "120 / 120 PASS" in eval_text and "100.0%" in eval_text, "reports/eval.md")
        extreme_text = open("reports/extreme.md", encoding="utf-8").read() if os.path.exists("reports/extreme.md") else ""
        check("极端场景无 FAIL", "0 FAIL" in extreme_text and "20 PASS" in extreme_text, "reports/extreme.md")
        readme = open("README.md", encoding="utf-8").read() if os.path.exists("README.md") else ""
        check("构造数据声明", "构造" in readme or "demo" in readme.lower(), "README.md")
    except Exception as exc:
        check("DoD 运行器", False, repr(exc)[:200])
    finally:
        client.close()
        if created_sessions:
            ids = ",".join("'" + sid.replace("'", "") + "'" for sid in created_sessions)
            docker("exec", "-T", "db", "psql", "-U", "kb", "-d", "kb", "-c",
                   f"DELETE FROM messages WHERE session_id IN ({ids}); DELETE FROM audit_logs WHERE object_id IN ({ids}); DELETE FROM sessions WHERE id IN ({ids});")

    passed = sum(1 for _, status, _ in rows if status == "PASS")
    failed = sum(1 for _, status, _ in rows if status == "FAIL")
    lines = ["# DoD 自检（G4）", "", f"- 时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
             f"- 服务：{BASE}", f"- 结果：**{passed} PASS / {failed} FAIL**（共 {len(rows)} 项）", "",
             "| 检查项 | 结果 | 证据 |", "|---|---|---|"]
    for name, status, detail in rows:
        lines.append(f"| {name} | **{status}** | {detail} |")
    os.makedirs("reports", exist_ok=True)
    with open("reports/dod.md", "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())





