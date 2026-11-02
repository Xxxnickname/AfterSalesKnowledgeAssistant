from __future__ import annotations

import hashlib
import math
import re
from collections import Counter

TOKEN_RE = re.compile(r"[A-Za-z0-9_\-]+|[\u4e00-\u9fff]")


def tokenize(text: str) -> list[str]:
    raw = TOKEN_RE.findall((text or "").lower())
    tokens = []
    for token in raw:
        tokens.append(token)
        if len(token) > 1 and token.isascii():
            tokens.extend(token[i:i + 3] for i in range(max(1, len(token) - 2)))
    return tokens


def normalize(text: str) -> str:
    return "".join(ch for ch in (text or "").lower() if ch.isalnum() or "\u4e00" <= ch <= "\u9fff")


def hash_embedding(text: str, dim: int = 384) -> list[float]:
    values = [0.0] * dim
    for token in tokenize(text):
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        idx = int.from_bytes(digest[:4], "big") % dim
        sign = 1.0 if digest[4] % 2 else -1.0
        values[idx] += sign
    norm = math.sqrt(sum(v * v for v in values)) or 1.0
    return [round(v / norm, 6) for v in values]


def cosine(a: list[float] | None, b: list[float] | None) -> float:
    if a is None or b is None or len(a) == 0 or len(b) == 0:
        return 0.0
    n = min(len(a), len(b))
    dot = sum(float(a[i]) * float(b[i]) for i in range(n))
    na = math.sqrt(sum(float(x) * float(x) for x in a[:n])) or 1.0
    nb = math.sqrt(sum(float(x) * float(x) for x in b[:n])) or 1.0
    return max(0.0, dot / (na * nb))


def bm25(query: str, docs: list[tuple[str, str]], k1: float = 1.5, b: float = 0.75) -> list[float]:
    q = tokenize(query)
    if not q or not docs:
        return [0.0] * len(docs)
    tokenized = [tokenize(text) for _, text in docs]
    avgdl = sum(len(t) for t in tokenized) / max(1, len(tokenized))
    df = Counter()
    for tokens in tokenized:
        for term in set(tokens):
            df[term] += 1
    n = len(tokenized)
    scores = []
    for tokens in tokenized:
        tf = Counter(tokens)
        score = 0.0
        for term in q:
            if not tf.get(term):
                continue
            idf = math.log(1 + (n - df[term] + 0.5) / (df[term] + 0.5))
            denom = tf[term] + k1 * (1 - b + b * len(tokens) / max(1, avgdl))
            score += idf * (tf[term] * (k1 + 1) / denom)
        scores.append(score)
    return scores


