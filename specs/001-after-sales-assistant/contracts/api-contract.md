# 接口契约（G0 冻结）— 项目一

> 前端按此 mock，后端按此实现。字段名一旦冻结，改动需 A0 批准并同步 `frontend.md`。
> 统一响应：`{code, message, data, trace_id}`；错误码见 plan 对应表。

## 1. 对话（SSE）

`POST /api/chat` → `text/event-stream`

请求：
```json
{"session_id":"s_001","message_id":"m_001","text":"NC-500 报 E01 怎么处理","images":[]}
```
事件流（每行 `data: {...}`）：
```json
{"type":"delta","text":"E01 是主轴伺服过载…"}
{"type":"citation","doc":"manual_NC-500_操作与维护手册.pdf","page":6,"section":"4 报警代码与处理"}
{"type":"done","message_id":"m_002","escalated":false,"trace_id":"tr_9f2c"}
```

## 2. 会话与接管

`GET /api/sessions/{id}` → 会话详情（含 messages、handover、status）
```json
{"code":0,"data":{"id":"s_001","status":"WAITING","queue_position":2,"eta_min":3,
 "handover":{"summary":"…","collected":{"故障码":"E01"},"ai_suggestion":"…","top_docs":["…"]}},"trace_id":"tr_1"}
```
`POST /api/sessions/{id}/takeover` → 成功 `200`；已被接管 `409 CONFLICT`
`POST /api/sessions/{id}/messages` → 坐席回复，返回 `message_id`

## 3. 知识与反馈

`GET /api/kb/docs` → 文档列表（`parse_status ∈ {pending,parsing,ready,failed}`）
`POST /api/feedback` → `{"session_id":"s_001","score":5,"comment":"…"}`

## 4. 未命中池

`GET /api/unmatched?days=7` → `[{question, count, last_seen, sample_session}]`
`POST /api/unmatched/{id}/faq-draft` → 生成草稿（不直接入库）
