from __future__ import annotations

import re
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import KbChunk, KbDoc, Ticket
from app.services.embeddings import hash_embedding, tokenize

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "samples" / "01"


def _model_from_name(name: str) -> str:
    match = re.search(r"manual_([A-Z0-9-]+)_", name, re.I)
    return match.group(1).upper() if match else "全系列"


def seed_manuals(db: Session, tenant_id: str) -> int:
    """解析文字型 PDF 手册；无 pypdf 或图片型 PDF 时跳过。"""
    try:
        from pypdf import PdfReader
    except Exception:
        return 0
    added = 0
    for pdf_path in sorted(SAMPLES.glob("manual_*.pdf")):
        model = _model_from_name(pdf_path.name)
        doc = db.scalar(select(KbDoc).where(KbDoc.tenant_id == tenant_id, KbDoc.model == model, KbDoc.name.like("%操作%手册%")))
        if not doc:
            doc = db.scalar(select(KbDoc).where(KbDoc.tenant_id == tenant_id, KbDoc.model == model))
        if not doc:
            doc = KbDoc(
                tenant_id=tenant_id, name=pdf_path.name.replace("manual_", "").replace(".pdf", ""),
                model=model, version="演示", doc_type="PDF · 文字型",
                size_mb=round(pdf_path.stat().st_size / 1024 / 1024, 1), note="由 samples/01 手册解析",
            )
            db.add(doc)
            db.flush()
        existing = db.scalar(select(func.count()).select_from(KbChunk).where(KbChunk.tenant_id == tenant_id, KbChunk.doc_id == doc.id, KbChunk.section_path.like("第 % 页"))) or 0
        if existing:
            continue
        doc_added = 0
        try:
            reader = PdfReader(str(pdf_path))
            for page_no, page in enumerate(reader.pages, start=1):
                text = (page.extract_text() or "").strip()
                if len(text) < 20:
                    continue
                text = re.sub(r"\s+", " ", text)
                db.add(KbChunk(
                    tenant_id=tenant_id, doc_id=doc.id, page_no=page_no,
                    section_path=f"第 {page_no} 页", text=text[:2200],
                    embedding=hash_embedding(text), tokens=len(tokenize(text)),
                ))
                doc_added += 1
            doc.pages = len(reader.pages)
            doc.chunks_count = existing + doc_added
            doc.parse_status = "ready"
            doc.progress = 100
            doc.status = "active"
            db.add(doc)
            added += doc_added
        except Exception:
            continue
    db.commit()
    return added


def seed_ticket_chunks(db: Session, tenant_id: str) -> int:
    """把工单现象与处理方案变成可检索的“历史工单”切片。"""
    doc = db.scalar(select(KbDoc).where(KbDoc.tenant_id == tenant_id, KbDoc.name == "历史工单库 2026"))
    if not doc:
        doc = KbDoc(tenant_id=tenant_id, name="历史工单库 2026", model="全系列", version="2026", doc_type="工单", note="由 tickets.csv 入库")
        db.add(doc)
        db.flush()
    existing = db.scalar(select(func.count()).select_from(KbChunk).where(KbChunk.tenant_id == tenant_id, KbChunk.doc_id == doc.id)) or 0
    if existing:
        return 0
    added = 0
    for ticket in db.scalars(select(Ticket).where(Ticket.tenant_id == tenant_id)).all():
        text = (
            f"设备型号 {ticket.model}，故障码 {ticket.fault_code}。"
            f"现象：{ticket.description}。处理方案：{ticket.resolution}。"
            f"工单：{ticket.ticket_id}；渠道：{ticket.channel}。"
        )
        if len(text) < 20:
            continue
        db.add(KbChunk(
            tenant_id=tenant_id, doc_id=doc.id, page_no=1, section_path=f"历史工单 {ticket.ticket_id}",
            text=text, embedding=hash_embedding(text), tokens=len(tokenize(text)),
        ))
        added += 1
    doc.chunks_count = added
    doc.pages = 1
    doc.parse_status = "ready"
    doc.status = "active"
    doc.progress = 100
    db.add(doc)
    db.commit()
    return added
def seed_support_chunks(db: Session, tenant_id: str) -> int:
    """补充章节索引、保养注意事项与口语化映射（构造的售后知识，便于演示多跳）。"""
    doc = db.scalar(select(KbDoc).where(KbDoc.tenant_id == tenant_id, KbDoc.name == "售后通用知识 2026"))
    if not doc:
        doc = KbDoc(tenant_id=tenant_id, name="售后通用知识 2026", model="全系列", version="2026", doc_type="知识卡", note="演示用售后通用知识")
        db.add(doc)
        db.flush()
    existing = db.scalar(select(func.count()).select_from(KbChunk).where(KbChunk.tenant_id == tenant_id, KbChunk.doc_id == doc.id)) or 0
    if existing:
        return 0
    added = 0
    codes = {"NC-500": "E01/E03/E05/E07/E11", "PK-1200": "A02/A06", "CV-800": "C01/C02/C03/C05"}
    for model, fault_codes in codes.items():
        texts = [
            (1, "第 4 章 报警代码", f"设备型号 {model} 第 4 章 报警代码。常见故障码包括 {fault_codes}；报警发生时先停机、记录代码，再按章节排查。"),
            (9, "保养注意事项", f"设备型号 {model} 的报警处理后保养：润滑导轨丝杠，清理电柜滤网，检查冷却液和接头；适用于 {fault_codes} 等报警后的复测。"),
            (1, "口语化术语", f"设备型号 {model}。客户说“老趴窝/趴窝”通常指设备停机，常见原因包括过载、报警未复位、冷却或气源异常。"),
        ]
        for page, section, text in texts:
            db.add(KbChunk(tenant_id=tenant_id, doc_id=doc.id, chunk_type="support", page_no=page, section_path=section, text=text, embedding=hash_embedding(text), tokens=len(tokenize(text))))
            added += 1
    doc.chunks_count = added
    doc.pages = 1
    doc.parse_status = "ready"
    doc.status = "active"
    doc.progress = 100
    db.add(doc)
    db.commit()
    return added
def seed_fault_cards(db: Session, tenant_id: str) -> int:
    doc = db.scalar(select(KbDoc).where(KbDoc.tenant_id == tenant_id, KbDoc.name == "售后故障处理卡 2026"))
    if not doc:
        doc = KbDoc(tenant_id=tenant_id, name="售后故障处理卡 2026", model="全系列", version="2026", doc_type="知识卡", note="由历史工单提炼的处理卡")
        db.add(doc)
        db.flush()
    # 每张卡自带“章节 + 处置 + 保养”三段信息，保证单条回答可自洽，不靠拼运气召回。
    cards = [
        ("NC-500", "E01", "NC-500 第 4 章 报警代码 E01 主轴伺服过载：检查切削参数与主轴负载，确认风扇与电柜滤网无堵塞。报警处理后保养：润滑导轨丝杠，清理电柜滤网。"),
        ("NC-500", "E02", "NC-500 第 4 章 报警代码 E02 主轴编码器信号异常：检查编码器电缆屏蔽层与插头，核对主轴驱动参数；若刀塔换刀超时，检查换刀气压(≥0.5MPa)与刀塔定位销。报警处理后保养：润滑导轨丝杠，清理电柜滤网。"),
        ("NC-500", "E03", "NC-500 第 4 章 报警代码 E03 回参考点异常：手动回参考点后重新对刀，检查限位开关与编码器零位。报警处理后保养：润滑导轨丝杠，清理电柜滤网。"),
        ("NC-500", "E05", "NC-500 第 4 章 报警代码 E05 切削液液位低：补充切削液至液位上限，检查液位传感器与过滤网。报警处理后保养：润滑导轨丝杠，清理电柜滤网。"),
        ("NC-500", "E07", "NC-500 第 4 章 报警代码 E07 编码器信号异常：检查编码器电缆屏蔽层接地、插头是否松动，必要时更换编码器线。报警处理后保养：润滑导轨丝杠，清理电柜滤网。"),
        ("NC-500", "E09", "NC-500 第 4 章 报警代码 E09 液压压力不足：检查液压油位与滤芯，测系统压力是否达 4.5MPa。报警处理后保养：润滑导轨丝杠，清理电柜滤网。"),
        ("NC-500", "E11", "NC-500 第 4 章 报警代码 E11 程序段语法错误：检查 G 代码与刀具补偿号，删除空程序段后重新运行。报警处理后保养：润滑导轨丝杠，清理电柜滤网。"),
        ("NC-500", "E12", "NC-500 第 4 章 报警代码 E12 电池电压低：更换控制柜电池(3.6V)，重新导入参数备份。报警处理后保养：润滑导轨丝杠，清理电柜滤网。"),
        ("CV-800", "C02", "CV-800 托辊异响：更换异响托辊，检查轴承润滑与托辊组同轴度。"),
        ("PK-1200", "A06", "PK-1200 称重单元零点漂移：空载清零并做两点标定，检查称重传感器接线。"),
    ]
    added = 0
    for model, code, card_text in cards:
        key = f"故障卡 {model} {code}"
        exists = db.scalar(select(KbChunk).where(KbChunk.tenant_id == tenant_id, KbChunk.doc_id == doc.id, KbChunk.section_path == key))
        if exists:
            if exists.text != card_text:
                exists.text = card_text
                exists.embedding = hash_embedding(card_text)
                exists.tokens = len(tokenize(card_text))
                db.add(exists)
                added += 1
            continue
        db.add(KbChunk(tenant_id=tenant_id, doc_id=doc.id, chunk_type="fault_card", page_no=1, section_path=key, text=card_text, embedding=hash_embedding(card_text), tokens=len(tokenize(card_text))))
        added += 1
    doc.chunks_count = (doc.chunks_count or 0) + added
    doc.pages = 1
    doc.parse_status = "ready"
    doc.status = "active"
    doc.progress = 100
    db.add(doc)
    db.commit()
    return added


