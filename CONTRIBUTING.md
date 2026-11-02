# 贡献指南

## 本地开发

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

## 运行与验证

```powershell
.\.venv\Scripts\python -m pytest -q
.\.venv\Scripts\python eval\run.py --limit 0
```

Docker 联调：

```powershell
docker build -t kb-app:dev .
docker build -t kb-pgvector:pg15 docker/db
docker compose -p kb up -d --no-build
Invoke-RestMethod http://127.0.0.1:8001/health
```

## 提交前检查

- [ ] `pytest` 通过
- [ ] 不提交 `.env`、`.env.prod`、数据库文件或模型 Key
- [ ] 新增接口更新 `docs/API.md`
- [ ] 架构变化更新 `docs/ARCHITECTURE.md`
- [ ] 评测口径变化更新 `docs/EVALUATION.md`
- [ ] 截图变化更新 `docs/screenshots/` 与 `docs/SCREENSHOTS.md`

## 代码风格

- Python 3.11，保持类型标注和清晰的异常边界。
- 检索、转人工和配置变更必须有可复现测试或基准。
- 不把演示数据、mock 指标或未实现能力写成生产结果。

## Pull Request

PR 描述请包含：问题、改动、验证命令、结果、风险和未覆盖项。涉及安全或权限的变更请单独标注。
