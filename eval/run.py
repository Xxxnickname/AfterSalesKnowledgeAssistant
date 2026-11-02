from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import time
import uuid
from collections import defaultdict

import httpx

BASE = os.getenv("ACCEPTANCE_BASE_URL", "http://127.0.0.1:8001")
DATASET = os.getenv("EVAL_DATASET", "samples/01/eval_v1.jsonl")


def flush_rate_bucket() -> bool:
    """清空本机评测触发的限流桶，避免 120 条被 20 次/分钟挡掉。"""
    try:
        subprocess.run(
            ["docker", "compose", "-p", "kb", "exec", "-T", "redis", "sh", "-c",
             "redis-cli --scan --pattern 'rate:*' | xargs -r redis-cli del"],
            check=True, capture_output=True, timeout=20,
        )
        return True
    except Exception:
        return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="0 = 全量")
    parser.add_argument("--batch-size", type=int, default=20)
    parser.add_argument("--no-flush", action="store_true", help="不清限流桶，按 20 条/分钟等待")
    parser.add_argument("--out", default="reports/eval.md")
    args = parser.parse_args()

    with open(DATASET, encoding="utf-8") as handle:
        rows = [json.loads(line) for line in handle if line.strip()]
    if args.limit:
        rows = rows[: args.limit]
    run_id = uuid.uuid4().hex[:8]
    client = httpx.Client(base_url=BASE, timeout=30)
    details = []
    latencies = []
    started = time.time()
    try:
        for offset in range(0, len(rows), args.batch_size):
            if not args.no_flush:
                flush_rate_bucket()
            if args.no_flush and offset:
                time.sleep(max(0, 61 - (time.time() % 60)))
            for idx in range(offset, min(offset + args.batch_size, len(rows))):
                row = rows[idx]
                t0 = time.perf_counter()
                try:
                    response = client.post(
                        "/api/chat",
                        json={
                            "message_id": f"eval_{run_id}_{idx + 1}",
                            "text": row["question"],
                            "images": [],
                            "session_id": f"eval_{run_id}_{idx + 1}",
                        },
                    )
                except Exception as exc:  # 网络异常单独记录
                    details.append({"qid": row.get("qid"), "category": row.get("category"), "ok": False,
                                    "status": "ERR", "answer": repr(exc)[:160], "escalated": False, "cited": False})
                    continue
                elapsed = time.perf_counter() - t0
                latencies.append(elapsed)
                data = response.json().get("data", {}) if response.status_code == 200 else {}
                answer = data.get("answer", "") or ""
                cited = bool(data.get("citations"))
                keywords = row.get("expected_keywords", [])
                ok = response.status_code == 200 and all(k in answer for k in keywords) and (not row.get("must_cite") or cited)
                details.append({
                    "qid": row.get("qid"), "category": row.get("category"), "ok": ok,
                    "status": response.status_code, "answer": answer[:160].replace("\n", " "),
                    "escalated": bool(data.get("escalated")), "cited": cited,
                    "missing": [k for k in keywords if k not in answer],
                })
    finally:
        client.close()

    passed = sum(1 for d in details if d["ok"])
    total = len(details)
    escalations = sum(1 for d in details if d["escalated"])
    cited = sum(1 for d in details if d["cited"])
    by_cat = defaultdict(lambda: [0, 0])
    for d in details:
        by_cat[d["category"]][1] += 1
        by_cat[d["category"]][0] += int(d["ok"])

    def pct(value: float) -> float:
        return round(value * 100, 1)

    p50 = statistics.median(latencies) if latencies else 0
    p95 = sorted(latencies)[max(0, int(len(latencies) * 0.95) - 1)] if latencies else 0

    lines = [
        "# 评测记录（G3 全量）", "",
        f"- 时间：{time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 数据：`{DATASET}`（{total} 条）",
        f"- 服务：{BASE}",
        f"- 脚本：`eval/run.py --limit 0`",
        f"- 结果：**{passed} / {total} PASS（{pct(passed / total if total else 0)}%）**",
        f"- 转人工率：{pct(escalations / total if total else 0)}%",
        f"- 引用覆盖率：{pct(cited / total if total else 0)}%",
        f"- 响应时延 P50 / P95：{p50:.2f}s / {p95:.2f}s",
        f"- 总耗时：{time.time() - started:.0f}s", "",
        "## 分类结果", "", "| 分类 | 通过 | 通过率 |", "|---|---|---|",
    ]
    for category, (ok, count) in sorted(by_cat.items()):
        lines.append(f"| {category} | {ok}/{count} | {pct(ok / count)}% |")
    failed = [d for d in details if not d["ok"]]
    lines += ["", "## 失败明细", ""]
    if failed:
        lines += ["| QID | 分类 | HTTP | 缺失关键词 | 回答摘要 |", "|---|---|---|---|---|"]
        for d in failed:
            lines.append(f"| {d['qid']} | {d['category']} | {d['status']} | {', '.join(d.get('missing') or []) or '-'} | {d['answer']} |")
    else:
        lines.append("无。")
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    print(f"EVAL {passed}/{total} passed; escalate={escalations}; cited={cited}; p50={p50:.2f}s p95={p95:.2f}s")
    for d in failed:
        print(d["qid"], "FAIL", "missing=", d.get("missing"), d["answer"])
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())

