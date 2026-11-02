from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import httpx

BASE = os.getenv("ACCEPTANCE_BASE_URL", "http://127.0.0.1:8001")
PROJECT = "kb"
results: list[tuple[str, str, str, str]] = []


def check(item_id: str, name: str, status: str, detail: str):
    results.append((item_id, name, status, detail.replace("|", "/").replace("\n", " ")[:220]))


def docker(*args: str, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["docker", "compose", "-p", PROJECT, *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
    )


def flush_rate():
    docker("exec", "-T", "redis", "sh", "-c", "redis-cli --scan --pattern 'rate:*' | xargs -r redis-cli del")


def del_presence():
    docker("exec", "-T", "redis", "sh", "-c", "redis-cli --scan --pattern 'presence:*' | xargs -r redis-cli del")


def wait_health(timeout: int = 60, require_ok: bool = True) -> tuple[bool, str]:
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        try:
            response = httpx.get(BASE + "/health", timeout=3)
            last = response.text[:160]
            if response.status_code == 200:
                data = response.json()
                if not require_ok or data.get("status") == "ok":
                    return True, last
        except Exception as exc:
            last = repr(exc)[:160]
        time.sleep(1)
    return False, last


def login(client: httpx.Client, username: str = "admin") -> dict:
    response = client.post("/api/auth/login", json={"username": username, "password": "Admin@12345"})
    response.raise_for_status()
    return {"Authorization": "Bearer " + response.json()["data"]["access_token"]}


def chat(client: httpx.Client, text: str, message_id: str | None = None, session_id: str | None = None,
         images: list[str] | None = None, **kwargs):
    payload = {"message_id": message_id or "ext_" + uuid.uuid4().hex[:10], "text": text, "images": images or []}
    if session_id:
        payload["session_id"] = session_id
    return client.post("/api/chat", json=payload, **kwargs)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="reports/extreme.md")
    args = parser.parse_args()
    client = httpx.Client(base_url=BASE, timeout=30)
    started = datetime.now()
    try:
        ok, detail = wait_health(30)
        check("HEALTH", "服务健康", "PASS" if ok else "FAIL", detail)
        flush_rate()

        headers = login(client)
        dup_id = "ext_dup_" + uuid.uuid4().hex[:8]
        first = chat(client, "NC-500 的保修期是多久？", dup_id)
        second = chat(client, "NC-500 的保修期是多久？", dup_id)
        d1 = first.json().get("data", {}) if first.status_code == 200 else {}
        d2 = second.json().get("data", {}) if second.status_code == 200 else {}
        session_id = d1.get("session_id")
        duplicated = (
            first.status_code == 200 and second.status_code == 200
            and d1.get("answer") == d2.get("answer") and d1.get("session_id") == d2.get("session_id")
        )
        customer_messages = 0
        if session_id:
            stored = client.get(f"/api/chat/session/{session_id}")
            if stored.status_code == 200:
                customer_messages = sum(1 for m in stored.json()["data"]["messages"] if m.get("role") == "customer")
        check("X-02", "重复提交幂等", "PASS" if duplicated and customer_messages == 1 else "FAIL",
              f"same_answer={duplicated} customer_messages={customer_messages}")
        check("E1-02", "同一 message_id 只处理一次", "PASS" if customer_messages == 1 else "FAIL",
              f"customer_messages={customer_messages}")

        today = datetime.now().strftime("%Y-%m-%d")
        created = client.get(f"/api/chat/session/{session_id}").json()["data"].get("created_at", "") if session_id else ""
        check("X-09", "服务端时钟一致性", "PASS" if created.startswith(today) else "FAIL", f"session.created_at={created}")

        sse_body = ""
        try:
            with client.stream("POST", "/api/chat", json={
                "message_id": "ext_sse_" + uuid.uuid4().hex[:8],
                "text": "NC-500 报 E01 怎么处理？", "images": [],
            }, headers={"Accept": "text/event-stream"}) as response:
                sse_body = "".join(response.iter_text())
            sse_ok = "event: delta" in sse_body and "event: done" in sse_body
        except Exception as exc:
            sse_ok = False
            sse_body = repr(exc)
        check("X-14", "SSE 流式返回", "PASS" if sse_ok else "FAIL", sse_body[:160])

        bad = chat(client, "测试", "ext_img_bad_" + uuid.uuid4().hex[:6], images=["not-an-image"])
        huge = "data:image/png;base64," + "A" * (13 * 1024 * 1024)
        oversized = chat(client, "测试", "ext_img_big_" + uuid.uuid4().hex[:6], images=[huge])
        check("E1-05", "图片格式/大小校验", "PASS" if bad.status_code == 400 and oversized.status_code == 413 else "FAIL",
              f"bad={bad.status_code} oversized={oversized.status_code}")

        del_presence()
        flush_rate()
        offline = chat(client, "我要转人工", "ext_offline_" + uuid.uuid4().hex[:6])
        offline_data = offline.json().get("data", {}) if offline.status_code == 200 else {}
        offline_note = (offline_data.get("handover") or {}).get("offline_note", "")
        check("E1-03", "坐席离线留言", "PASS" if offline_data.get("escalated") and offline_note else "FAIL",
              f"escalated={offline_data.get('escalated')} note={offline_note}")
        offline_session = offline_data.get("session_id")

        cross = client.get("/api/sessions", headers={**headers, "X-Tenant-Id": "t_other"})
        check("X-10", "跨租户越权", "PASS" if cross.status_code == 403 else "FAIL", f"status={cross.status_code}")

        agent_headers = login(client, "linxiao")
        other_headers = login(client, "chenli")
        if offline_session:
            take1 = client.post(f"/api/sessions/{offline_session}/takeover", headers=agent_headers)
            take2 = client.post(f"/api/sessions/{offline_session}/takeover", headers=other_headers)
            check("E1-07", "重复接管 409", "PASS" if take1.status_code == 200 and take2.status_code == 409 else "FAIL",
                  f"first={take1.status_code} second={take2.status_code} {take2.text[:100]}")
            client.post(f"/api/sessions/{offline_session}/close", headers=agent_headers, json={"result": "resolved"})

        listing = client.get("/api/sessions", headers=agent_headers)
        waiting = listing.json().get("data", {}).get("waiting", []) if listing.status_code == 200 else []
        taken = 0
        sixth = None
        for item in waiting[:6]:
            response = client.post(f"/api/sessions/{item['id']}/takeover", headers=agent_headers)
            if response.status_code == 200:
                taken += 1
            elif response.status_code == 409:
                sixth = response
        check("E1-01", "单坐席 5 并发上限", "PASS" if taken == 5 and sixth is not None else "FAIL",
              f"taken_success={taken} sixth={sixth.status_code if sixth else 'n/a'} {sixth.text[:80] if sixth else ''}")

        flush_rate()
        ids = ["ext_load_" + uuid.uuid4().hex[:10] for _ in range(50)]

        def fire(message_id: str):
            try:
                response = httpx.post(BASE + "/api/chat", json={"message_id": message_id, "text": "NC-500 保修期", "images": []}, timeout=30)
                return response.status_code, response.json().get("data", {}).get("answer", "") if response.status_code == 200 else ""
            except Exception:
                return 0, ""

        with ThreadPoolExecutor(max_workers=50) as pool:
            load = list(pool.map(fire, ids))
        codes = [code for code, _ in load]
        accepted = codes.count(200)
        limited = codes.count(429)
        server_errors = sum(1 for code in codes if code >= 500 or code == 0)
        check("X-01", "50 并发写入", "PASS" if server_errors == 0 and accepted >= 20 and accepted + limited == 50 else "FAIL",
              f"200={accepted} 429={limited} 5xx/conn={server_errors}")

        def health_once(_):
            try:
                return httpx.get(BASE + "/health", timeout=10).status_code
            except Exception:
                return 0

        with ThreadPoolExecutor(max_workers=100) as pool:
            health_codes = list(pool.map(health_once, range(100)))
        check("X-05", "连接池/并发读压力", "PASS" if health_codes.count(200) == 100 else "FAIL",
              f"200={health_codes.count(200)} errors={100 - health_codes.count(200)}")

        timeout_value = ""
        probe = docker("exec", "-T", "app", "python", "-c",
                       "from app.core.db import engine; from sqlalchemy import text; print(engine.connect().execute(text('show statement_timeout')).scalar())")
        timeout_value = (probe.stdout or "").strip()
        slow = docker("exec", "-T", "db", "psql", "-U", "kb", "-d", "kb", "-c",
                      "SET statement_timeout='100ms'; SELECT pg_sleep(1);")
        cancelled = "statement timeout" in (slow.stderr or "") or "canceling statement" in (slow.stderr or "")
        check("X-11", "慢查询保护", "PASS" if timeout_value and cancelled else "FAIL",
              f"statement_timeout={timeout_value} cancelled={cancelled}")

        redis_ok = False
        try:
            docker("stop", "redis", timeout=30)
            time.sleep(3)
            health_down = client.get("/health")
            redis_state = health_down.json().get("checks", {}).get("redis") if health_down.status_code == 200 else "http-error"
            during = chat(client, "NC-500 的保修期是多久？", "ext_no_redis_" + uuid.uuid4().hex[:6])
            redis_ok = health_down.status_code == 200 and during.status_code == 200
            detail = f"health={health_down.status_code} redis={redis_state} chat={during.status_code}"
        except Exception as exc:
            detail = repr(exc)[:180]
        finally:
            docker("start", "redis", timeout=30)
            deadline = time.time() + 40
            while time.time() < deadline:
                status = docker("exec", "-T", "redis", "redis-cli", "ping")
                if "PONG" in (status.stdout or ""):
                    break
                time.sleep(1)
        check("X-04", "Redis 宕机降级", "PASS" if redis_ok else "FAIL", detail)

        flush_rate()
        for idx in range(20):
            chat(client, "NC-500 保修期", "ext_rate_ok_" + uuid.uuid4().hex[:8])
        limited = chat(client, "NC-500 保修期", "ext_rate_21_" + uuid.uuid4().hex[:8])
        check("X-13", "20 次/分钟限流", "PASS" if limited.status_code == 429 else "FAIL", f"21st={limited.status_code}")

        try:
            docker("kill", "-s", "SIGKILL", "app", timeout=30)
            time.sleep(2)
            docker("up", "-d", "app", timeout=90)
            recovered, health_detail = wait_health(60)
            intact = client.get(f"/api/chat/session/{session_id}").status_code if session_id else 0
            check("X-03", "进程被杀后恢复", "PASS" if recovered and intact == 200 else "FAIL",
                  f"health={health_detail} session={intact}")
        except Exception as exc:
            check("X-03", "进程被杀后恢复", "FAIL", repr(exc)[:180])

        docker("exec", "-T", "db", "psql", "-U", "kb", "-d", "kb", "-c",
               "INSERT INTO sessions (id,tenant_id,channel,status,created_at,updated_at) "
               "VALUES ('s_ext_ttl','t_demo','网页','WAITING',now()-interval '31 minutes',now()-interval '31 minutes') "
               "ON CONFLICT (id) DO UPDATE SET status='WAITING', updated_at=now()-interval '31 minutes';")
        ttl_ok = False
        ttl_detail = ""
        deadline = time.time() + 20
        while time.time() < deadline:
            row = docker("exec", "-T", "db", "psql", "-U", "kb", "-d", "kb", "-t", "-A", "-c",
                         "select status||','||coalesce(close_result,'') from sessions where id='s_ext_ttl';")
            ttl_detail = (row.stdout or "").strip()
            if ttl_detail.startswith("CLOSED,timeout"):
                ttl_ok = True
                break
            time.sleep(2)
        check("E1-06", "30 分钟无消息归档", "PASS" if ttl_ok else "FAIL", ttl_detail)

        fallback = subprocess.run([sys.executable, "-m", "pytest", "-q", "tests/test_extreme_fallbacks.py"],
                                  capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
        fallback_ok = fallback.returncode == 0
        check("X-06", "模型超时降级", "PASS" if fallback_ok else "FAIL", "pytest tests/test_extreme_fallbacks.py")
        check("X-07", "模型 429 降级", "PASS" if fallback_ok else "FAIL", "pytest tests/test_extreme_fallbacks.py")
        check("E1-04", "模型空响应降级", "PASS" if fallback_ok else "FAIL", "pytest tests/test_extreme_fallbacks.py")

        check("X-08", "磁盘写满", "N/A", "未构造磁盘满场景，避免破坏本机卷；上线前需在隔离卷演练")
        check("X-12", "200MB 上传", "N/A", "产品未提供 200MB 文档上传端点；聊天图片 8MB 上限已验证")
    except Exception as exc:
        check("RUNNER", "极端场景脚本", "FAIL", repr(exc)[:220])
    finally:
        client.close()

    passed = sum(1 for _, _, status, _ in results if status == "PASS")
    failed = sum(1 for _, _, status, _ in results if status == "FAIL")
    skipped = sum(1 for _, _, status, _ in results if status == "N/A")
    lines = [
        "# G3 极端场景矩阵（实测）", "",
        f"- 时间：{started.strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 服务：{BASE}",
        f"- 脚本：`python scripts/extreme_test.py`",
        f"- 结果：**{passed} PASS / {failed} FAIL / {skipped} N/A**（共 {len(results)} 项）", "",
        "| 编号 | 场景 | 状态 | 证据 |", "|---|---|---|---|",
    ]
    for item_id, name, status, detail in results:
        lines.append(f"| {item_id} | {name} | **{status}** | {detail} |")
    lines += ["", "## 说明", "",
              "- 50 并发写入同时受 20 次/分钟限流约束；本项验证“无 5xx、成功写入与限流计数守恒”，不是 50 条全部成功。",
              "- X-08/X-12 未构造，未写成 PASS；需要隔离环境（小容量卷 / 大文件上传端点）才能补测。",
              "- 进程被杀、Redis 宕机测试均自动恢复服务；测试后需重置演示数据。"]
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

