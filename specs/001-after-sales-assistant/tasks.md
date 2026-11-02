# Tasks: 设备售后智能客服

**输入**：`spec.md`（FR-001…FR-022）· `plan.md`

> **前置门禁**：本文件从 Phase 3 起属于后端实现，必须在 `tasks-frontend.md` 的 **G1 用户评审通过后** 才能开始；Phase 1/2 的脚手架与建表可提前做。
**格式**：`[ID] [P?] [Story] 描述`；`[P]` = 可并行（不同文件、无先后依赖）

## Phase 1: Setup

- [ ] T001 按 plan.md 建目录骨架（app/ tests/ migrations/ eval/ scripts/ reports/）
- [ ] T002 写 `docker-compose.yml`：postgres(pgvector) / redis / neo4j / app / worker，端口取 `APP_PORT`
- [ ] T003 写 `.env.example`（MODEL_BASE_URL、MODEL_API_KEY、DB_DSN、REDIS_URL、NEO4J_URI、APP_PORT、SESSION_TTL_MIN、KB_MIN_SCORE）
- [ ] T004 复制 `samples/01` 到仓库 `samples/`，写 `samples/README.md` 声明为构造数据
- [ ] T005 `app/core/config.py`：Pydantic Settings 读取全部环境变量，缺失即启动失败
- [ ] T006 `app/main.py`：FastAPI 实例 + `/health`（含 DB/Redis/Neo4j 探活）+ 统一异常处理

## Phase 2: Foundational（阻塞后续所有故事）

- [ ] T007 `app/core/errors.py`：错误码枚举（对应计划书 §14.3）+ 统一响应 `{code,message,data,trace_id}`
- [ ] T008 `app/core/tenant.py`：租户上下文中间件，所有请求注入 `current_tenant()`
- [ ] T009 `app/core/db.py` + `migrations/0001_init.py`：tenants/users/sessions/messages/kb_docs/chunks/tickets/faq_drafts/audit_logs（全表带 tenant_id，唯一索引带 tenant_id）
- [ ] T010 [P] `app/core/security.py`：Argon2id 哈希、session 签发/校验、失败计数与锁定
- [ ] T011 [P] `app/core/audit.py`：写审计（谁/何时/对象/结果/trace_id），异步批量落库
- [ ] T012 [P] `tests/test_fr_020_auth.py`、`tests/test_fr_021_audit.py`：登录、越权、审计写入
- [ ] T013 基础仓储层 `app/repositories/base.py`：强制注入 tenant_id，禁止业务层裸 SQL

## Phase 3: US1 网页问答并给出处（P1，MVP）

- [ ] T014 [P] [US1] `app/services/parse.py`：PDF(PyMuPDF 渲染+OCR)/PNG 解析 → 按标题层级切分，保留 `page_no`、`section_path`
- [ ] T015 [P] [US1] `app/services/embed.py`：调用 embedding 接口写 `chunks.embedding`（pgvector）
- [ ] T016 [US1] `app/services/retrieve.py`：BM25(pg_trgm/tsvector) + 向量双路召回 → RRF → bge-reranker，返回带分数与出处
- [x] T017 [US1] `app/services/answer.py`：LangGraph 图（意图→检索→转人工判定→生成→引用校验），引用缺失则转人工
- [ ] T018 [US1] `app/services/graph.py`：Neo4j 四类关系写入与多跳查询（设备→故障→部件→方案）
- [ ] T019 [US1] `app/api/chat.py`：`POST /api/chat`（SSE 流式），写 messages + trace
- [ ] T020 [US1] `app/services/idempotency.py`：以 `message_id` 去重，重复直接返回首次结果（FR-003）
- [ ] T021 [US1] `app/services/ratelimit.py`：单 IP/设备 20 条/分钟（Redis 令牌桶）
- [ ] T022 [US1] `app/services/vision.py`：图片消息 → 视觉模型 → 识别失败转人工
- [ ] T023 [US1] `app/static/chat.html`：聊天窗（含引用展开、转人工常驻、四态）
- [ ] T024 [US1] `tests/test_fr_007_retrieve.py`、`test_fr_008_citation.py`、`test_fr_002_channel.py`
- [ ] T025 [US1] 跑 `eval/run.py`，自助解决率 ≥50%（W2 阶段门槛），记入 `reports/eval.md`

## Phase 4: US2 转人工与坐席工作台（P2）

- [ ] T026 [P] [US2] `app/services/escalate.py`：6 条转人工规则 + 交接包生成
- [ ] T027 [P] [US2] `app/services/queue.py`：待接入队列、位次与预计等待、60s 心跳回收
- [ ] T028 [US2] `app/services/takeover.py`：Redis 分布式锁（TTL 90s 续租）+ 并发接管 409
- [ ] T029 [US2] `app/api/agent.py`：接管/回复/快捷回复/转接/结束并标记
- [ ] T030 [US2] `app/static/workbench.html`：三栏工作台（列表/交接包+消息流/客户信息+推荐）
- [ ] T031 [US2] `tests/test_fr_010_handover.py`、`test_fr_012_takeover_conflict.py`、`test_fr_014_heartbeat.py`
- [ ] T032 [US2] 单坐席并发上限 5 的拒绝逻辑与提示（FR-013）

## Phase 5: US3 知识运营闭环（P3）

- [ ] T033 [P] [US3] `app/services/unmatched.py`：未命中问题池，按频次排序、样例会话
- [ ] T034 [P] [US3] `app/services/faq.py`：FAQ 草稿生成 → 人工确认 → 入库 → 5 秒内可检索
- [ ] T035 [US3] `app/api/admin.py`：文档上传/重新解析/下架/版本替换、FAQ 与术语维护
- [ ] T036 [US3] 评价接口与满意度落库（FR-018）+ 看板聚合查询（FR-019）
- [ ] T037 [US3] `tests/test_fr_015_unmatched.py`、`test_fr_016_doc_version.py`

## Phase 6: Polish & 收敛

- [ ] T038 极端场景脚本 `scripts/acceptance.py`：覆盖计划书 §19 全部 21 条
- [ ] T039 DoD 自检 `scripts/check_dod.py`：逐条输出 PASS/FAIL
- [ ] T040 压测：100 并发连接 / 20 QPS / 50 并发写入，记录 P95 与错误率
- [ ] T041 运维手册：监控阈值（计划书 §10.1）、备份恢复、回滚步骤
- [ ] T042 README：10 分钟跑起来（照 `quickstart.md`）
- [ ] T043 最终评测：自助解决率 ≥65%、首响 P95 ≤2s、上下文完整率 100%、误答 <1%

## Dependencies

- Phase 1 → Phase 2 → Phase 3 顺序不可跳（T007–T013 是所有故事的前提）
- US1 完成后才可测 US2（转人工需要真实会话）
- US3 依赖 US1 的检索链路；T036 的看板依赖 US1+US2 的数据
- T038/T039 依赖全部功能完成

## Parallel Opportunities

- T010/T011/T012 可并行（不同文件）
- T014/T015 可并行（解析与向量化接口解耦）
- T026/T027 可并行；T033/T034 可并行
- 前端静态页（T023/T030）可与后端接口并行开发，用 mock JSON 先行


