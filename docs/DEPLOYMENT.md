# 部署手册

## 1. 本机 Docker 部署

### 前置条件

- Docker Desktop / Docker Engine
- Docker Compose v2
- 端口 `8001` 可用

### 启动

```powershell
Copy-Item .env.example .env
docker build -t kb-app:dev .
docker build -t kb-pgvector:pg15 docker/db
docker compose -p kb up -d --no-build
Invoke-RestMethod http://127.0.0.1:8001/health
```

Compose 工程名固定为 `kb`，应用端口固定为 `8001`。不要改成 8000。

### 查看状态

```powershell
docker compose -p kb ps
docker compose -p kb logs --tail=100 app
docker compose -p kb logs --tail=100 worker
```

### 重置演示数据

```powershell
.\scripts\reset_demo.ps1 -Yes
```

只用于本机演示。脚本会清空并重播租户、用户、会话、知识库和 FAQ。

## 2. 环境变量

本机使用 `.env`，生产模板使用 `.env.prod`。两者都不能提交到版本库。

| 变量 | 说明 | 本机默认 |
|---|---|---|
| `APP_ENV` | `dev` 或 `prod` | `dev` |
| `APP_PORT` | 服务端口，固定 8001 | `8001` |
| `APP_BIND` | 宿主绑定地址 | `127.0.0.1` |
| `DATABASE_URL` | PostgreSQL 连接串 | Compose 内部 `db:5432` |
| `REDIS_URL` | Redis 连接串 | `redis://redis:6379/0` |
| `NEO4J_URI` | Neo4j Bolt 地址 | `bolt://neo4j:7687` |
| `MODEL_BASE_URL` | OpenAI 兼容模型地址 | 空，使用检索式降级 |
| `MODEL_API_KEY` | 模型 Key | 空 |
| `DEMO_MODE` | 演示自动登录 | 本机 `true`，生产必须 `false` |
| `SEED_DEMO` | 是否导入演示数据 | 本机 `true`，生产必须 `false` |
| `ADMIN_INITIAL_PASSWORD` | 首个管理员初始密码 | 仅演示使用 |

生产密钥、数据库密码、Neo4j 密码和管理员密码请使用随机值；不要使用 `.env.example` 中的占位值。

## 3. 生产前预检

```powershell
Copy-Item .env.prod.example .env.prod
# 填写 APP_SECRET、POSTGRES_PASSWORD、NEO4J_PASSWORD、ADMIN_INITIAL_PASSWORD
.\scripts\prod_preflight.ps1
```

预检会检查：

- `APP_ENV=prod`
- `DEMO_MODE=false`
- `SEED_DEMO=false`
- `APP_PORT=8001`
- 弱密钥、默认密码、模型 Key 成对配置
- Compose 配置语法

生产启动命令：

```powershell
docker compose -p kb --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml up -d --no-build
```

生产覆盖文件会：

- 将应用和 Neo4j 绑定到 `127.0.0.1`
- 增加日志轮转和内存限制
- 给 app / worker 加 `no-new-privileges`
- 关闭演示数据导入

## 4. 健康检查与故障排查

```powershell
Invoke-RestMethod http://127.0.0.1:8001/health
docker compose -p kb ps
docker compose -p kb logs --tail=200 app
```

| 现象 | 排查 |
|---|---|
| 8001 无响应 | `docker compose -p kb ps`，确认 `kb-app-1` 为 healthy |
| database down | 检查 `kb-db-1` 健康状态和 `DATABASE_URL` |
| redis down | 检查 `kb-redis-1`；应用会降级到内存缓存 |
| neo4j down | 检查 `kb-neo4j-1` 与 `NEO4J_AUTH` |
| 页面数据为空 | 检查是否误设 `SEED_DEMO=false`，或执行演示数据重置 |
| 登录失败 | 本机确认 `DEMO_MODE=true`；生产确认管理员密码和数据库已初始化 |

## 5. 备份与恢复

PostgreSQL 逻辑备份示例：

```powershell
New-Item -ItemType Directory -Force -Path .\backups | Out-Null
docker compose -p kb exec -T db pg_dump -U kb -d kb --no-owner --no-privileges > .\backups\kb.sql
```

恢复前必须在隔离环境验证；不要直接覆盖生产库。Neo4j 和 `.env.prod` 也应纳入独立备份，正式上线前完成一次恢复演练。

## 6. 生产验收清单

- [ ] TLS / 反向代理 / 域名
- [ ] `APP_SECRET`、数据库密码、Neo4j 密码、管理员密码全部替换
- [ ] `DEMO_MODE=false`、`SEED_DEMO=false`
- [ ] 真实模型 Key 与超时降级验证
- [ ] PostgreSQL / Neo4j 备份与恢复演练
- [ ] 监控、告警、集中日志
- [ ] 真实工单抽样验收和业务指标基线
- [ ] 服务器防火墙仅开放反向代理入口

本仓库验证的是本机可部署版本，不代表已完成生产服务器验收。
