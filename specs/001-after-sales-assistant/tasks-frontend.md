# 前端任务（Frontend Tasks）— 项目一

> 只做 G0 → G1。**全部用 mock 数据，不写后端业务逻辑。**
> 完成后停下，等用户按 `frontend.md` §五 评审打勾。

## Phase F0: 契约冻结（G0）

- [x] F001 A1+A2 共同确认 `contracts/api-contract.md` 的 6 个接口字段与错误码，签字（A0 记录）
- [x] F002 `static/mock/*.json` 按 frontend.md §四 生成 8 个文件（真实字段，不是占位）
- [x] F003 `static/js/api.js`：所有请求集中一处，`MOCK=true` 时读本地 json，`MOCK=false` 时走 `/api/*`

## Phase F1: 骨架与设计令牌

- [x] F004 `static/tokens.css`：颜色/字号/间距/圆角/阴影变量（唯一来源）
- [x] F005 `static/base.css`：重置、排版、表格、表单、按钮、卡片
- [x] F006 `static/js/router.js`：hash 路由 + 四态容器（`?state=` 可强制切换）
- [x] F007 `static/js/components.js`：Toast、Modal、Confirm、EmptyState、ErrorPage（带 trace_id）

## Phase F2: 页面实现（按屏拆，可并行）

- [x] F010 [P] 1-1 客户聊天窗（含引用折叠、图片上传占位、转人工按钮）
- [x] F011 [P] 1-2 评价弹层（1–5 星 + 文字）
- [x] F012 [P] 1-3 坐席工作台（三栏 + 交接包 4 段 + 推荐 Top3）
- [x] F013 [P] 1-4 未命中问题池（排序 + 样例会话抽屉）
- [x] F014 [P] 1-5 知识库管理（文档/FAQ/术语三 Tab + 解析进度）
- [x] F015 [P] 1-6 数据看板（4 卡 + 2 图 + 差评列表）
- [x] F016 [P] 1-7 会话质检（列表 + 详情 + 问题类型标记）
- [x] F017 [P] 1-8 用户与角色（仅 admin，越权显示 403 页）

## Phase F3: 状态与适配

- [x] F020 全部列表页四态可触发（loading/empty/error/403）
- [x] F021 375px / 768px / 1366px 三档响应式检查
- [x] F022 键盘可达：Tab 顺序、Esc 关弹层、焦点可见
- [x] F023 空态文案与错误文案（中文，含下一步动作）

## GATE ★ 用户评审（必须停下）

- [x] F030 交付可点地址（`http://localhost:8001/`）+ 8 屏走查清单
- [x] F031 记录用户意见到 `reports/g1-review.md`（通过 / 逐条修改）
- [x] F032 修改完成后二次确认

> G1 未签字前，`tasks.md` 的 Phase 3 及之后（后端业务逻辑）一律不得开始。

> **2026-11-01 状态**：F001–F032 已完成。用户已确认前端可进入 G2；字体/颜色整改记录见 `reports/g1-review.md`。G0 冻结记录见 `reports/g0-contract-signoff.md`，G1 评审表见 `reports/g1-review.md`。


