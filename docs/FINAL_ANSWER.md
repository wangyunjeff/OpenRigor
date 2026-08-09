# Final handoff — 2026-08-09

jeff，`OpenRigor` 已经准备为可直接开工的公开项目，计划发布在：

<https://github.com/wangyunjeff/OpenRigor>

本次交付不是只有一份分析文档。仓库包含完整技术尽调、管理层摘要、架构、协议、安全边界、实施路线，以及一个已通过类型检查、单元测试、生产构建和真实 SSE 烟测的 Phase 0 垂直切片。

最关键的产品判断是：AIcss 只是可能帮助快速搭聊天表现层的 UI 源码，不是 ClawsGO 的 AI/Agent 后端。真正要复现的是可恢复任务、Agent 编排、隔离云工作区、事件重放、文件交付、用量账本和 SaaS 控制面。

本地启动：

```powershell
cd E:\0_Code\OpenRigor
pnpm install
pnpm dev:api
```

另开终端：

```powershell
cd E:\0_Code\OpenRigor
pnpm dev:web
```

打开 <http://localhost:5173>。当前执行器是确定性 demo，不执行用户代码；下一步严格按 `docs/ROADMAP.md` 的 M1 推进 PostgreSQL 事件表、事务 outbox、队列 worker、sandbox provider 和工件存储。
