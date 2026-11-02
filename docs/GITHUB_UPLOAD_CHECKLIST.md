# GitHub 发布检查清单

## 仓库内容

- [ ] `README.md` 能解释项目定位、截图、架构、启动和评测
- [ ] `docs/ARCHITECTURE.md` 包含容器拓扑、请求时序和 LangGraph 状态图
- [ ] `docs/DEPLOYMENT.md` 包含本机与生产前配置
- [ ] `docs/API.md` 与实际接口一致
- [ ] `docs/EVALUATION.md` 区分构造数据和线上数据
- [ ] `docs/screenshots/` 图片可正常显示
- [ ] `SECURITY.md`、`CONTRIBUTING.md`、`CHANGELOG.md` 已加入
- [ ] 选择开源许可证或明确保留私有

## 敏感信息

- [ ] `.env` / `.env.prod` 未提交
- [ ] 数据库密码、模型 Key、JWT、Cookie、Token 未出现在仓库
- [ ] 截图不包含真实客户隐私
- [ ] Git 历史中没有旧密钥；如有，先轮换密钥再清理历史

## GitHub 设置

- [ ] 仓库描述：设备售后知识问答与转人工闭环，FastAPI + LangGraph + pgvector
- [ ] Topics：`rag`、`fastapi`、`langgraph`、`postgresql`、`pgvector`、`docker-compose`、`customer-service`、`knowledge-base`
- [ ] 默认分支保护
- [ ] Actions CI 可运行
- [ ] 如公开，确认 License、README 截图和 demo 数据边界

## 本地 Git

```powershell
git init
git add .
git commit -m "feat: initial public-ready after-sales knowledge assistant"
git branch -M main
git remote add origin <repo-url>
git push -u origin main
```

推送前先确认 `.env`、`.env.prod`、`data/` 和临时截图目录没有被 `git add` 加入。
