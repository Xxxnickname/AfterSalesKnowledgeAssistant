# Quickstart: 设备售后智能客服

## 前置

- Docker Desktop 已启动；Python 3.11
- 复制样本：`xcopy /E /I "D:\Desktop\简历\项目计划书\samples\01" samples`
- 复制 `.env.example` 为 `.env`，填 `MODEL_API_KEY`

## 启动

```bash
docker compose up -d --build
curl -fsS "http://localhost:${APP_PORT:-8001}/health"
```

首次部署初始化管理员：

```bash
docker compose exec app python -m app.init_admin --username admin
```

## 最小验证（5 分钟）

1. 打开 `http://localhost:8001/` → 网页聊天窗
2. 问「NC-500 保修期多久」→ 应返回 12/18/3 个月并带手册页码
3. 问「E01 怎么处理」→ 应返回处理步骤 + 第 4 章引用
4. 问「你们老板电话多少」→ 应转人工，且交接包含 4 段
5. 用 admin 登录工作台 → 接管该会话 → 回复 → 结束并标记

## 验收

```bash
pytest -q
python scripts/acceptance.py --all --out reports/acceptance.md
python eval/run.py --set samples/01/eval_v1.jsonl --out reports/eval.md
python scripts/check_dod.py --out reports/dod.md
```

三份报告都在 `reports/`，任何 FAIL 必须修复后重跑，不允许口头声明通过。
