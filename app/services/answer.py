from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, TypedDict

import httpx
from langgraph.graph import END, START, StateGraph
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.services.escalate import REQUEST_RE, SENSITIVE_RE, should_escalate
from app.services.retrieve import Candidate, retrieve


@dataclass
class AnswerResult:
    answer: str
    citations: list[dict] = field(default_factory=list)
    escalate: bool = False
    reason: str = ""
    confidence: float = 0.0
    candidates: list[Candidate] = field(default_factory=list)


def _citation(c: Candidate) -> dict:
    return {
        "doc": c.doc or "售后知识库",
        "page": c.page or 0,
        "section": c.section or "相关章节",
        "excerpt": (c.text or "")[:520],
        "score": round(float(c.score), 2),
    }


def _compact_chunk(text: str, limit: int = 900) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "")).strip()
    if len(cleaned) <= limit:
        return cleaned
    cut = cleaned[:limit]
    for sep in ["。", "；", "\n"]:
        pos = cut.rfind(sep)
        if pos > limit * 0.55:
            return cut[:pos + 1]
    return cut.rstrip() + "……"


def _model_answer(question: str, candidates: list[Candidate]) -> str | None:
    settings = get_settings()
    if not settings.model_base_url or not settings.model_api_key:
        return None
    context = "\n\n".join(
        f"[{i + 1}] {c.doc} 第 {c.page} 页 {c.section}\n{c.text[:900]}"
        for i, c in enumerate(candidates[:4])
    )
    prompt = (
        "你是设备售后客服。只能依据给定资料回答，不得补充资料外的型号、金额、保修承诺。"
        "回答用简短步骤，中文；最后不要编造页码。\n\n资料：\n" + context + "\n\n客户问题：" + question
    )
    try:
        with httpx.Client(timeout=8) as client:
            response = client.post(
                settings.model_base_url.rstrip("/") + "/chat/completions",
                headers={"Authorization": "Bearer " + settings.model_api_key},
                json={
                    "model": settings.model_name,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1,
                    "max_tokens": 500,
                },
            )
            response.raise_for_status()
            payload = response.json()
            return (payload.get("choices") or [{}])[0].get("message", {}).get("content", "").strip() or None
    except Exception:
        return None


class AnswerState(TypedDict, total=False):
    """LangGraph 状态：一次问答从意图到引用校验的完整上下文。"""
    db: Any
    tenant_id: str
    question: str
    has_images: bool
    history: Any
    intent_label: str
    candidates: list[Candidate]
    confidence: float
    answer: str
    citations: list[dict]
    escalate: bool
    reason: str


def _intent_node(state: AnswerState) -> dict:
    """只做意图标记，真正的转人工判定在检索后的 guard 节点完成。"""
    question = state.get("question", "")
    if state.get("has_images"):
        intent = "image"
    elif REQUEST_RE.search(question):
        intent = "handoff_request"
    elif SENSITIVE_RE.search(question):
        intent = "sensitive"
    else:
        intent = "answer"
    return {"intent_label": intent}


def _retrieve_node(state: AnswerState) -> dict:
    candidates = retrieve(state["db"], state["tenant_id"], state.get("question", ""))
    confidence = float(candidates[0].score) if candidates else 0.0
    return {"candidates": candidates, "confidence": confidence}


def _guard_node(state: AnswerState) -> dict:
    escalate, reason = should_escalate(
        state.get("question", ""),
        score=float(state.get("confidence", 0.0)),
        has_images=bool(state.get("has_images")),
        history=state.get("history"),
    )
    return {"escalate": escalate, "reason": reason}


def _generate_node(state: AnswerState) -> dict:
    candidates = state.get("candidates") or []
    top = candidates[0] if candidates else None
    if top is None:
        return {"answer": "", "citations": []}

    if top.kind == "faq":
        answer = (top.question + chr(10) + top.answer) if top.question else top.answer
        return {"answer": answer, "citations": [_citation(top)]}

    context_parts: list[str] = []
    for candidate in candidates[:2]:
        snippet = _compact_chunk(candidate.text, 420)
        if snippet and snippet not in context_parts:
            context_parts.append(snippet)
    context = "\n\n".join(context_parts)
    answer = _model_answer(state.get("question", ""), candidates) or (
        "根据知识库中的相关章节，建议按以下信息处理：\n" + context
    )
    citations = [_citation(candidate) for candidate in candidates[:3]]
    return {"answer": answer, "citations": citations}


def _verify_node(state: AnswerState) -> dict:
    """引用存在性校验；没有可展示引用时退回人工，不输出无出处答案。"""
    if not state.get("answer") or not state.get("citations"):
        return {"escalate": True, "reason": "引用不可回溯"}
    return {"escalate": False, "reason": ""}


def _escalate_node(state: AnswerState) -> dict:
    return {
        "answer": "这个问题涉及需要人工确认的信息，我先为你转接售后同事，请稍等。",
        "citations": [],
        "escalate": True,
    }


def _finalize_node(state: AnswerState) -> dict:
    return {}


def _route_guard(state: AnswerState) -> str:
    return "escalate" if state.get("escalate") else "generate"


def _route_verify(state: AnswerState) -> str:
    return "escalate" if state.get("escalate") else "finalize"


def _build_answer_graph():
    graph = StateGraph(AnswerState)
    graph.add_node("intent", _intent_node)
    graph.add_node("retrieve", _retrieve_node)
    graph.add_node("guard", _guard_node)
    graph.add_node("generate", _generate_node)
    graph.add_node("verify", _verify_node)
    graph.add_node("handoff", _escalate_node)
    graph.add_node("finalize", _finalize_node)
    graph.add_edge(START, "intent")
    graph.add_edge("intent", "retrieve")
    graph.add_edge("retrieve", "guard")
    graph.add_conditional_edges(
        "guard",
        _route_guard,
        {"escalate": "handoff", "generate": "generate"},
    )
    graph.add_edge("generate", "verify")
    graph.add_conditional_edges(
        "verify",
        _route_verify,
        {"escalate": "handoff", "finalize": "finalize"},
    )
    graph.add_edge("handoff", END)
    graph.add_edge("finalize", END)
    return graph.compile()


ANSWER_GRAPH = _build_answer_graph()


def answer_question(db: Session, tenant_id: str, question: str, *, has_images: bool = False, history=None) -> AnswerResult:
    """通过 LangGraph 执行：意图 → 检索 → 转人工判定 → 生成 → 引用校验。"""
    state = ANSWER_GRAPH.invoke({
        "db": db,
        "tenant_id": tenant_id,
        "question": question,
        "has_images": has_images,
        "history": history,
    })
    return AnswerResult(
        answer=state.get("answer", ""),
        citations=state.get("citations", []),
        escalate=bool(state.get("escalate")),
        reason=state.get("reason", ""),
        confidence=float(state.get("confidence", 0.0)),
        candidates=state.get("candidates", []),
    )




