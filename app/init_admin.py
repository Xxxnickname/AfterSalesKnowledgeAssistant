from __future__ import annotations

import argparse

from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import SessionLocal, init_db
from app.core.security import hash_password
from app.models import Tenant, User


def main():
    parser = argparse.ArgumentParser(description="初始化管理员账号")
    parser.add_argument("--username", default="admin")
    parser.add_argument("--password", default=None)
    parser.add_argument("--name", default="陈立")
    args = parser.parse_args()
    settings = get_settings()
    init_db()
    with SessionLocal() as db:
        tenant = db.scalar(select(Tenant).where(Tenant.code == settings.default_tenant))
        if not tenant:
            tenant = Tenant(id=settings.default_tenant, code=settings.default_tenant, name="恒锐精工演示租户")
            db.add(tenant)
            db.flush()
        user = db.scalar(select(User).where(User.tenant_id == tenant.id, User.username == args.username))
        password = args.password or settings.admin_password
        if user:
            user.password_hash = hash_password(password)
            user.role = "admin"
            user.status = "active"
        else:
            user = User(
                tenant_id=tenant.id, username=args.username, password_hash=hash_password(password),
                name=args.name, role="admin", staff_role="supervisor", dept="系统管理部",
            )
            db.add(user)
        db.commit()
        print(f"admin ready: {args.username} / {password}")


if __name__ == "__main__":
    main()
