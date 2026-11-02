from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ChatSession, Message

SENSITIVE_RE = re.compile(r"退款|退货|赔|索赔|投诉|起诉|法律|责任|发票|金额|费用|保修期争议|过保|免费换|赔偿", re.I)
REQUEST_RE = re.compile(r"转人工|人工客服|真人|找客服|叫客服|人工处理", re.I)


def should_escalate(question: str, *, score: float, has_images: bool, history: list[Message] | None = None) -> tuple[bool, str]:
    if has_images:
        return True, "图片需要人工确认"
    if REQUEST_RE.search(question):
        return True, "客户要求转人工"
    if SENSITIVE_RE.search(question):
        return True, "涉及金额/责任判定等敏感意图"
    if score < 0.30:
        return True, "检索未命中或置信度不足"
    if history and len(history) >= 8:
        return True, "连续多轮未解决"
    return False, ""


def build_handover(session: ChatSession, question: str, answer: str, candidates: list, reason: str) -> dict:
    collected = {
        "设备型号": session.device_model or "未识别",
        "设备序列号": session.device_serial or "未提供",
        "故障描述": question[:120],
        "联系人": f"{session.customer_name} · {session.customer_phone or '未留电话'}",
    }
    doc_items = []
    for c in candidates[:3]:
        doc_items.append({"doc": c.doc or "售后知识库", "page": c.page or 0, "section": c.section or "相关章节", "score": round(float(c.score), 2)})
    summary = f"客户咨询：{question[:160]}。AI 结论：{answer[:160] if answer else '未能形成可靠答案'}。转人工原因：{reason}。"
    return {
        "summary": summary,
        "collected": collected,
        "ai_suggestion": "请坐席核对设备型号与故障码，按推荐知识逐条确认；涉及责任、金额或安全风险时不要直接承诺，必要时升级主管。",
        "top_docs": doc_items,
        "reason": reason,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def queue_position(db: Session, tenant_id: str, session: ChatSession) -> int:
    if session.status != "WAITING":
        return 0
    count = db.scalar(select(func.count()).select_from(ChatSession).where(
        ChatSession.tenant_id == tenant_id,
        ChatSession.status == "WAITING",
        ChatSession.created_at <= session.created_at,
        ChatSession.id != session.id,
    )) or 0
    return int(count) + 1


def escalate(db: Session, tenant_id: str, session: ChatSession, *, question: str, answer: str, candidates: list, reason: str) -> dict:
    package = build_handover(session, question, answer, candidates, reason)
    session.status = "WAITING"
    session.handover = package
    session.queue_entered_at = datetime.now(timezone.utc)
    session.assigned_agent_id = None
    session.assigned_agent_name = ""
    db.add(session)
    return package
