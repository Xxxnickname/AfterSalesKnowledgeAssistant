# Implementation Plan: 设备售后智能客服

**Branch**: `001-after-sales-assistant` ｜ **Spec**: `./spec.md` ｜ **Date**: 2026-11-01

## Summary

用 FastAPI 提供网页聊天与坐席工作台两套接口；LangGraph 编排「检索 → 生成 → 置信度判定 → 转人工」；pgvector 存切片向量、Neo4j 存「设备—故障—部件—方案」四类关系；Redis 存会话与幂等键；Langfuse 记录每轮链路。

## Technical Context

| 维度 | 取值 |
|---|---|
| 语言/框架 | Python 3.11 · FastAPI · Gunicorn(4 workers) |
| 编排 | LangGraph（意图 → 检索 → 生成 → 判定 → 转人工） |
| 检索 | BM25 + pgvector 混合 → RRF → bge-reranker（本地） |
| 图谱 | Neo4j（四类关系，多跳问答溯源） |
| 存储 | PostgreSQL 16 + pgvector（业务与向量）、Redis 7（会话/幂等/锁） |
| 解析 | OCR + 视觉模型（图像型 PDF、图纸 PNG） |
| 评测/观测 | RAGAS · Langfuse |
| 异步 | Celery（解析、归档、报表） |
| 部署 | Docker Compose；Nginx 反向代理；`APP_PORT` 默认 **8001**（三项目并行，避免冲突） |
| 模型 | `deepseek-flash`，OpenAI 兼容，base_url 走环境变量 |
| 目标平台 | Linux 容器（本地 Windows Docker 亦可） |
| 规模 | 客户侧 100–300 次/天；坐席 20 人；峰值 20 QPS |
| 数据 | `samples/01`（60 FAQ / 120 工单 / 3 手册 / 12 图纸 / 120 评测） |

## 端口分配（三项目并行，不得冲突）

| 用途 | 本项目默认 | 其他项目（勿用） |
|---|---|---|
| 应用 APP_PORT | **8001** | 8001 / 8002 / 8003 中其余两个 |
| PostgreSQL | 不映射宿主（调试端口 5431） | 5431 / 5432 / 5433 |
| Redis | 不映射宿主（调试端口 6381） | 6381 / 6382 / 6383 |
| Neo4j | 7474 / 7687（仅本项目使用） | — |

- 默认**只 publish `app`**（项目二再加 `gateway`）；数据库与缓存走 compose 内部网络，不占宿主端口
- 需要本机连库/看 Redis 时，才临时映射上表的调试端口
- 三个项目的 compose 工程名必须不同（`kb` / `oa` / `plan`），避免容器与网络互相覆盖

## Constitution Check

| 原则 | 本方案如何满足 | 结论 |
|---|---|---|
| I 有据可答 | 生成层强制注入检索片段 + 引用校验，未命中即转人工 | PASS |
| II 先转人工 | 6 条判定规则 + 下游超时兜底 | PASS |
| III 技术栈冻结 | 与技术栈清单逐项一致（含 Neo4j / RAGAS / OCR） | PASS |
| IV 多租户与最小权限 | 全表 `tenant_id`、仓储层注入、两级角色 | PASS |
| V 可复现评测 | 固定 `eval_v1.jsonl` + 固定种子 + 单变量复测 | PASS |

> 复杂度豁免：Neo4j 属额外组件（示意图谱缓存），已在 §Complexity Tracking 说明，不做全量 GraphRAG。

## Project Structure

### Documentation (this feature)

```
specs/001-after-sales-assistant/
├── spec.md          # 需求（用户故事 + FR + 成功标准）
├── plan.md          # 本文件
├── tasks.md         # 任务分解
└── quickstart.md    # 跑起来 / 验收
```

### Source Code (repository root)

```
app/
├── main.py                # FastAPI 入口
├── api/                   # chat / agent / admin / auth
├── core/                  # 配置、日志、错误码、鉴权、租户
├── models/                # SQLAlchemy 模型
├── schemas/               # Pydantic 出入参
├── services/              # 检索、生成、转人工判定、会话
├── workers/               # 解析、归档
└── static/                # 聊天窗 + 坐席工作台
tests/                     # pytest（用例名带 FR 编号）
migrations/                # alembic
samples/                   # 从 项目计划书\samples\01 复制
eval/                      # run.py + 数据集副本
scripts/                   # acceptance.py / check_dod.py
reports/                   # acceptance.md / eval.md / dod.md
docker-compose.yml
.env.example
README.md
```

## Phases

| 阶段 | 内容 | 出口条件 |
|---|---|---|
| P0 研究 | 切分策略、rerank 阈值、OCR 方案对比（写 `research.md`） | 三项各有结论与依据 |
| P1 骨架 | compose + 建表 + 健康检查 + 登录 | `curl /health` 200，admin 可登录 |
| P2 地基 | 租户中间件、错误码、审计、幂等、限流 | 三个横切用例通过 |
| P3 US1 | 解析入库 → 混合检索 → 生成带引用 → 网页聊天窗 | SC-001/002 达标 |
| P4 US2 | 转人工判定 → 交接包 → 坐席工作台 | SC-003 + 并发接管 409 |
| P5 US3 | 未命中池 → FAQ 草稿 → 版本替换 | 高频未命中可转 FAQ |
| P6 收敛 | 评测报告、极端场景、部署与运维手册 | §19 全 PASS |

## Complexity Tracking

| 决策 | 为什么需要 | 更简单的替代为何不够 |
|---|---|---|
| Neo4j 图谱层 | 多跳问答（故障→部件→方案）需可溯源路径 | 纯向量检索在多跳上召回不足，且无法解释跳转依据 |
| bge-reranker 本地部署 | 首包延迟与成本要求 | LLM 重排单次成本高一个量级 |
| 图像型 PDF + OCR | 客户手册多为扫描件 | 纯文本解析对扫描件直接失效 |
