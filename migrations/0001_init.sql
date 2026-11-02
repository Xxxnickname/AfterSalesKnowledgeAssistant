-- 0001_init.sql
-- PostgreSQL + pgvector 初始化。业务表由 app.core.db.init_db() 的 SQLAlchemy metadata 创建。
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(32) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES ('0001_init') ON CONFLICT DO NOTHING;
