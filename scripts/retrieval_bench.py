from __future__ import annotations

import argparse
import json
import re
import statistics
import time
from pathlib import Path

import app.services.retrieve as retrieve_module
from app.core.db import SessionLocal
from app.services.embeddings import normalize


def harden(question: str) -> str:
    """构造格式/口语压力变体：去掉型号连字符并替换常见口语表达。"""
    text = re.sub(r"(NC|PK|CV)-(\d+)", r"\1\2", question or "")
    text = text.replace("怎么处理", "咋处理").replace("保修期是多久", "保修多长时间")
    text = text.replace("报警", "报错").replace("的", "").replace("？", "")
    return text


def _hit_rank(candidates, expected_keywords: list[str]) -> int | None:
    keys = [normalize(key) for key in expected_keywords]
    for index, candidate in enumerate(candidates, 1):
        evidence = normalize(" ".join([
            candidate.question or "",
            candidate.text or "",
            candidate.section or "",
            candidate.doc or "",
        ]))
        if all(key in evidence for key in keys):
            return index
    return None


def evaluate(rows: list[dict], *, hard: bool) -> dict:
    hits1 = hits3 = 0
    reciprocal_rank = 0.0
    latencies: list[float] = []
    by_category: dict[str, dict] = {}
    with SessionLocal() as db:
        for row in rows:
            question = harden(row["question"]) if hard else row["question"]
            started = time.perf_counter()
            candidates = retrieve_module.retrieve(db, "t_demo", question)
            latencies.append((time.perf_counter() - started) * 1000)
            rank = _hit_rank(candidates, row.get("expected_keywords", []))
            category = row.get("category", "unknown")
            bucket = by_category.setdefault(category, {"n": 0, "top1": 0, "top3": 0, "rr": 0.0})
            bucket["n"] += 1
            if rank == 1:
                hits1 += 1
                hits3 += 1
                reciprocal_rank += 1.0
                bucket["top1"] += 1
                bucket["top3"] += 1
                bucket["rr"] += 1.0
            elif rank and rank <= 3:
                hits3 += 1
                reciprocal_rank += 1.0 / rank
                bucket["top3"] += 1
                bucket["rr"] += 1.0 / rank
            elif rank:
                reciprocal_rank += 1.0 / rank
    n = len(rows)
    for bucket in by_category.values():
        bucket["top1"] = round(bucket["top1"] / bucket["n"], 4)
        bucket["top3"] = round(bucket["top3"] / bucket["n"], 4)
        bucket["rr"] = round(bucket["rr"] / bucket["n"], 4)
    return {
        "n": n,
        "top1": round(hits1 / n, 4),
        "top3": round(hits3 / n, 4),
        "mrr": round(reciprocal_rank / n, 4),
        "p95_ms": round(sorted(latencies)[max(0, int(n * 0.95) - 1)], 2),
        "by_category": by_category,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="samples/01/eval_v1.jsonl")
    args = parser.parse_args()
    rows = [json.loads(line) for line in Path(args.dataset).read_text(encoding="utf-8").splitlines() if line.strip()]

    original_rewrite = retrieve_module.rewrite_query
    original_rerank = retrieve_module._rerank
    retrieve_module.rewrite_query = lambda text: text
    retrieve_module._rerank = lambda raw_q, rewritten_q, candidates: sorted(candidates, key=lambda item: item.score, reverse=True)
    baseline_hard = evaluate(rows, hard=True)
    retrieve_module.rewrite_query = original_rewrite
    retrieve_module._rerank = original_rerank

    result = {
        "dataset": args.dataset,
        "standard": evaluate(rows, hard=False),
        "hard_variants": {
            "baseline": baseline_hard,
            "final": evaluate(rows, hard=True),
        },
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
