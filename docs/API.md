# API 说明

## 基础信息

- Base URL：`http://127.0.0.1:8001`
- 认证：Bearer JWT；聊天接口允许匿名客户
- 管理接口：需要管理员或坐席角色
- 返回格式：非 SSE 接口统一为 `{code, message, data, trace_id}`
- 租户：默认使用 `x-tenant-id` 请求头，未提供时使用 `DEFAULT_TENANT`

## 认证

### 管理员 / 坐席登录

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "<password>"
}
```

### 演示自动登录

`POST /api/auth/demo` 仅在 `DEMO_MODE=true` 时可用。生产必须关闭。

## 核心接口

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| POST | `/api/chat` | 客户消息；JSON 或 SSE | 否 |
| POST | `/api/chat/escalate` | 主动转人工 | 否 |
| GET | `/api/chat/session/{session_id}` | 客户查看会话详情 | 否 |
| GET | `/api/sessions` | 待接入 / 进行中队列 | Bearer |
| POST | `/api/sessions/{id}/takeover` | 坐席接管；冲突返回 409 | Bearer |
| POST | `/api/sessions/{id}/messages` | 坐席回复 | Bearer |
| POST | `/api/sessions/{id}/close` | 结束会话 | Bearer |
| POST | `/api/sessions/{id}/heartbeat` | 坐席心跳 | Bearer |
| GET | `/api/kb/docs` | 文档与 FAQ 列表 | Bearer |
| GET | `/api/unmatched?days=30` | 未命中问题池 | Bearer |
| POST | `/api/unmatched/{id}/faq-draft` | 生成 FAQ 草稿 | Bearer |
| POST | `/api/feedback` | 1-5 星反馈 | 否 |
| GET | `/api/dashboard` | 指标看板 | Bearer |
| GET | `/api/qc/sessions` | 会话质检列表 | Bearer |
| GET | `/api/users` | 用户与角色 | Bearer |
| GET | `/api/audit` | 审计日志 | Bearer |
| GET | `/health` | DB / Redis / Neo4j 探活 | 否 |

## 聊天示例

```powershell
$body = @{
  message_id = "demo-001"
  text = "NC-500 报 E01 怎么处理？"
  images = @()
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8001/api/chat `
  -ContentType application/json `
  -Body $body
```

返回示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "session_id": "s_...",
    "answer": "根据知识库中的相关章节...",
    "citations": [
      {
        "doc": "NC-500 故障代码速查表",
        "page": 12,
        "section": "E01 / E02 主轴类报警",
        "excerpt": "..."
      }
    ],
    "escalated": false
  },
  "trace_id": "tr_..."
}
```

## SSE

请求头设置：

```http
Accept: text/event-stream
```

服务端返回 `event: delta` 与 `event: done`。SSE 与非 SSE 返回同一份答案与引用语义。

## 常见状态码

| 状态码 | 含义 |
|---|---|
| 200 | 成功 |
| 400 | 参数错误、图片格式/大小不符合要求 |
| 401 | 未登录或 token 无效 |
| 403 | 跨租户或角色越权 |
| 409 | 会话已被接管、坐席并发达到上限 |
| 413 | 图片或请求体过大 |
| 429 | 单 IP/设备触发限流 |
| 500 | 未处理异常；查看 `trace_id` 与审计日志 |

## 数据库与引用

回答引用不是前端拼接，而是检索候选的 `doc`、`page`、`section` 和 `excerpt`。没有可展示引用的答案会进入转人工分支，不返回无出处内容。
