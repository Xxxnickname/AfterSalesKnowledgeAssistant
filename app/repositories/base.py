from __future__ import annotations

from sqlalchemy import Select, select
from sqlalchemy.orm import Session


class TenantScopedRepository:
    """所有业务查询的租户边界；业务层禁止裸 SQL。"""

    def __init__(self, db: Session, tenant_id: str):
        self.db = db
        self.tenant_id = tenant_id

    def scoped(self, model) -> Select:
        return select(model).where(model.tenant_id == self.tenant_id)

