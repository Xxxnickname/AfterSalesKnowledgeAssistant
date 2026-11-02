# Changelog

## 2026-11-02

- 完成本机可部署版本与 Docker Compose 五服务编排。
- 接入 LangGraph 问答状态图：intent -> retrieve -> guard -> generate -> verify。
- 增加型号规范化、口语术语扩展、FAQ/BM25/哈希向量召回和规则重排。
- 构造压力集 Top-1 从 55/120 提升到 120/120。
- 完成 120/120 端到端回归、29 个 pytest、DoD 18/18 和极端场景验证。
- 增加生产配置模板、预检脚本、架构文档、部署文档、API 文档和界面截图。
