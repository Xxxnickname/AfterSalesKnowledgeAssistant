from __future__ import annotations

import csv
import re
from pathlib import Path

TERMS_PATH = Path(__file__).resolve().parents[2] / "samples" / "01" / "terms.csv"
_MODEL_RE = re.compile(r"\b(NC|PK|CV)[ -]?(\d{3,4})\b", re.I)


def _load_terms() -> list[tuple[str, str]]:
    if not TERMS_PATH.exists():
        return []
    rows: list[tuple[str, str]] = []
    with TERMS_PATH.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            spoken = (row.get("spoken") or "").strip()
            canonical = (row.get("canonical") or "").strip()
            if spoken and canonical:
                rows.append((spoken, canonical))
    return rows


_TERMS = _load_terms()


def canonicalize_models(text: str) -> str:
    """把 NC500 / nc 500 统一成 NC-500，恢复型号信号。"""
    return _MODEL_RE.sub(lambda m: f"{m.group(1).upper()}-{m.group(2)}", text or "")


def rewrite_query(text: str) -> str:
    """规范化型号并追加术语表中的手册同义词，供 BM25/向量召回使用。"""
    query = canonicalize_models(text)
    additions: list[str] = []
    for spoken, canonical in _TERMS:
        if spoken in query and canonical not in query and canonical not in additions:
            additions.append(canonical)
    return query + (" " + " ".join(additions) if additions else "")
