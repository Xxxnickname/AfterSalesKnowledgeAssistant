from __future__ import annotations

import os
from functools import lru_cache

from pydantic import BaseModel

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass


def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


class Settings(BaseModel):
    app_name: str = os.getenv("APP_NAME", "设备售后智能客服")
    app_env: str = os.getenv("APP_ENV", "dev")
    app_port: int = int(os.getenv("APP_PORT", "8001"))
    app_secret: str = os.getenv("APP_SECRET", "dev-only-change-me")
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./data/kb.db")
    redis_url: str = os.getenv("REDIS_URL", "memory://")
    neo4j_uri: str = os.getenv("NEO4J_URI", "")
    neo4j_user: str = os.getenv("NEO4J_USER", "neo4j")
    neo4j_password: str = os.getenv("NEO4J_PASSWORD", "")
    model_base_url: str = os.getenv("MODEL_BASE_URL", "")
    model_api_key: str = os.getenv("MODEL_API_KEY", "")
    model_name: str = os.getenv("MODEL_NAME", "deepseek-flash")
    embedding_dim: int = int(os.getenv("EMBEDDING_DIM", "384"))
    session_ttl_min: int = int(os.getenv("SESSION_TTL_MIN", "30"))
    kb_min_score: float = float(os.getenv("KB_MIN_SCORE", "0.30"))
    rate_limit_per_min: int = int(os.getenv("RATE_LIMIT_PER_MIN", "20"))
    max_concurrent: int = int(os.getenv("MAX_CONCURRENT", "5"))
    heartbeat_timeout_sec: int = int(os.getenv("HEARTBEAT_TIMEOUT_SEC", "60"))
    admin_username: str = os.getenv("ADMIN_USERNAME", "admin")
    admin_password: str = os.getenv("ADMIN_INITIAL_PASSWORD", "Admin@12345")
    seed_demo: bool = _bool("SEED_DEMO", True)
    demo_mode: bool = _bool("DEMO_MODE", True)
    default_tenant: str = os.getenv("DEFAULT_TENANT", "t_demo")
    tenant_name: str = os.getenv("TENANT_NAME", "恒锐精工演示租户")
    timezone: str = os.getenv("APP_TIMEZONE", "Asia/Shanghai")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")

    model_config = {"extra": "ignore"}


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def reset_settings() -> None:
    get_settings.cache_clear()


def validate_runtime_settings() -> None:
    """生产环境启动前拒绝演示模式和弱默认值。"""
    current = get_settings()
    if current.app_env.strip().lower() != "prod":
        return

    problems: list[str] = []
    if current.demo_mode:
        problems.append("DEMO_MODE 必须为 false")
    if current.seed_demo:
        problems.append("SEED_DEMO 必须为 false")
    if len(current.app_secret) < 32 or current.app_secret in {
        "dev-only-change-me",
        "change-me-to-a-long-random-string",
    }:
        problems.append("APP_SECRET 必须是至少 32 位随机值")
    if not current.database_url or ":@db" in current.database_url or "kbpass" in current.database_url:
        problems.append("DATABASE_URL 不能使用空密码或默认 kbpass")
    if not current.neo4j_password or current.neo4j_password == "neo4jpass":
        problems.append("NEO4J_PASSWORD 不能为空或使用默认 neo4jpass")
    if not current.admin_password or current.admin_password == "Admin@12345":
        problems.append("ADMIN_INITIAL_PASSWORD 不能为空或使用默认值")
    if problems:
        raise RuntimeError("生产配置检查失败：" + "；".join(problems))


settings = get_settings()


