from __future__ import annotations

from sqlalchemy import func, select

from app.core.db import SessionLocal, init_db
from app.models import ChatSession, Faq, KbDoc, UnmatchedQuestion, User
from app.services.seed import seed_demo


def main():
    init_db()
    with SessionLocal() as db:
        seed_demo(db)
        print("users", db.scalar(select(func.count()).select_from(User)))
        print("faqs", db.scalar(select(func.count()).select_from(Faq)))
        print("docs", db.scalar(select(func.count()).select_from(KbDoc)))
        print("sessions", db.scalar(select(func.count()).select_from(ChatSession)))
        print("unmatched", db.scalar(select(func.count()).select_from(UnmatchedQuestion)))


if __name__ == "__main__":
    main()
