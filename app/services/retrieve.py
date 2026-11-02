from __future__ import annotations

import re
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Faq, KbChunk, KbDoc
from app.services.embeddings import bm25, cosine, hash_embedding, normalize, tokenize
from app.services.query_rewrite import rewrite_query

MODEL_RE = re.compile(r"\b(NC-500|PK-1200|CV-800)\b", re.I)
FAULT_RE = re.compile(r"\b([A-Z]{1,2}\d{2,4})\b", re.I)


@dataclass
class Candidate:
    kind: str
    key: str
    score: float
    text: str
    answer: str = ""
    doc: str = ""
    page: int = 0
    section: str = ""
    question: str = ""
    raw: dict = field(default_factory=dict)


def _signals(text: str):
    models = {m.upper() for m in MODEL_RE.findall(text or "")}
    faults = {f.upper() for f in FAULT_RE.findall(text or "")}
    return models, faults


def _overlap(query: str, text: str) -> float:
    q = set(tokenize(query))
    d = set(tokenize(text))
    return len(q & d) / max(1, len(q))


def retrieve(db: Session, tenant_id: str, query: str, limit: int = 8) -> list[Candidate]:
    raw_q = (query or "").strip()
    if not raw_q:
        return []
    q = rewrite_query(raw_q)
    q_models, q_faults = _signals(q)

    faqs = db.scalars(select(Faq).where(Faq.tenant_id == tenant_id, Faq.status == "published")).all()
    unique: dict[str, Faq] = {}
    for faq in faqs:
        unique.setdefault(normalize(faq.question), faq)
    faqs = list(unique.values())
    faq_texts = [(f.id, f"{f.question} {f.answer} {f.category} {f.product_model}") for f in faqs]
    faq_bm = bm25(q, faq_texts)
    faq_max = max(faq_bm) if faq_bm else 1.0
    candidates: dict[str, Candidate] = {}

    for idx, faq in enumerate(faqs):
        f_models, f_faults = _signals(f"{faq.question} {faq.answer} {faq.product_model}")
        if q_faults and not (q_faults & f_faults):
            continue
        overlap = _overlap(raw_q, f"{faq.question} {faq.answer}")
        model_match = 1.0 if q_models and (q_models & f_models) else 0.0
        if not q_models and not q_faults and overlap < 0.35:
            continue
        bm_norm = (faq_bm[idx] / faq_max) if faq_max else 0.0
        exact = normalize(raw_q) in normalize(faq.question) or normalize(faq.question) in normalize(raw_q)
        score = 1.0 if exact else min(0.98, 0.62 * overlap + 0.25 * model_match + 0.13 * bm_norm)
        if score < 0.30 and not exact:
            continue
        c = Candidate(
            kind="faq", key=faq.id, score=score, text=faq.answer, answer=faq.answer,
            doc=faq.source_doc, page=faq.source_page or 0, section=faq.category, question=faq.question,
            raw={"id": faq.id, "category": faq.category, "model": faq.product_model},
        )
        candidates["faq:" + c.key] = c

    chunk_rows = db.execute(
        select(KbChunk, KbDoc).join(KbDoc, KbDoc.id == KbChunk.doc_id).where(
            KbChunk.tenant_id == tenant_id, KbDoc.status == "active", KbDoc.parse_status == "ready"
        )
    ).all()
    chunk_texts = [(c.id, f"{d.name} {c.section_path} {c.text}") for c, d in chunk_rows]
    chunk_bm = bm25(q, chunk_texts)
    chunk_max = max(chunk_bm) if chunk_bm else 1.0
    qv = hash_embedding(q)
    for idx, (chunk, doc) in enumerate(chunk_rows):
        bm_norm = (chunk_bm[idx] / chunk_max) if chunk_max else 0.0
        body = f"{doc.name} {chunk.section_path} {chunk.text}"
        c_models, c_faults = _signals(body)
        model_match = 1.0 if q_models and (q_models & c_models) else 0.0
        fault_match = 1.0 if q_faults and (q_faults & c_faults) else 0.0
        if not q_models and not q_faults and _overlap(raw_q, body) < 0.30:
            continue
        vec = cosine(chunk.embedding, qv)
        if q_faults and not fault_match:
            continue
        # 故障码出现在章节名（如“故障卡 CV-800 C02”）时给确定性加分，避免被通用章节挤到第 3 名。
        section_match = 1.0 if q_faults and any(code in (chunk.section_path or "").upper() for code in q_faults) else 0.0
        score = min(0.98, 0.62 * bm_norm + 0.22 * vec + 0.10 * model_match + 0.06 * fault_match + 0.10 * section_match)
        if "已转人工" in (chunk.text or ""):
            score *= 0.62
        if score < 0.30:
            continue
        c = Candidate(
            kind="chunk", key=chunk.id, score=score, text=chunk.text,
            doc=doc.name, page=chunk.page_no or 0, section=chunk.section_path or "",
            raw={"doc_id": doc.id, "chunk_id": chunk.id},
        )
        candidates["chunk:" + c.key] = c

    return _rerank(raw_q, q, list(candidates.values()))[:limit]


def _rerank(raw_q: str, rewritten_q: str, candidates: list[Candidate]) -> list[Candidate]:
    """规则重排：强化保修意图和故障码问答，不依赖外部模型。"""
    q_models, q_faults = _signals(rewritten_q)
    warranty = bool(re.search(r"保修|质保|保多久|保修期|多长时间", raw_q))
    fault_resolution = bool(re.search(r"怎么处理|咋处理|如何处理|处理方案|怎么修|咋修", raw_q))
    for c in candidates:
        body = f"{c.question or ''} {c.text or ''} {c.section or ''}"
        if c.kind == "faq":
            if warranty and "保修" in body:
                c.score = min(0.99, c.score + 0.18)
            if fault_resolution and q_faults and any(code in body.upper() for code in q_faults):
                c.score = min(0.99, c.score + 0.18)
        else:
            if q_faults and any(code in body.upper() for code in q_faults):
                c.score += 0.03
            if "处理方案" in (c.text or "") or "处理：" in (c.text or ""):
                c.score += 0.02
            # 通用“常见故障码包括…”章节只做索引，不应压过带处理方案的答案卡/工单。
            if "常见故障码包括" in (c.text or "") and "处理" not in (c.text or ""):
                c.score -= 0.08
    return sorted(candidates, key=lambda x: x.score, reverse=True)




