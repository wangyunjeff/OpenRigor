# OpenRigor 立项与复刻执行摘要

致 Jeff：这份文件是本轮最终交付结论的仓库内版本；完整证据与资源清单见 [TECHNICAL_REPORT.md](TECHNICAL_REPORT.md)。

## 结论先行

ClawsGO 的核心不是一个聊天框，而是一套“持久任务运行时 + 隔离云工作区 + Agent 编排 + 文件交付 + SaaS 控制面”。AIcss 更接近可参考的对话 UI 源码目录，不是 ClawsGO 的模型、Agent 或云电脑引擎。公开证据没有支持二者存在直接技术依赖；OpenRigor 因此采用 clean-room 路线。

## 已完成的仓库准备

- 将 2026-08-09 调研原文归档到 `docs/TECHNICAL_REPORT.md`。
- 将管理层决策、首期范围和启动命令归档到本文件。
- 定义共享 `RunRequest` / `RunEvent` 协议，覆盖 snapshot、文本增量、reasoning、tool、file、subagent、status 和完成事件。
- 提供本地 API/SSE 服务和 React 控制台，能提交一个任务、实时查看事件、取消任务并恢复历史事件。
- 提供架构、路线图、安全边界、协议说明和本地依赖编排文件。

## 建议技术栈

| 层 | 首选 | 说明 |
|---|---|---|
| Web | React + Vite + TypeScript | 交互密集、流式状态和文件预览；后续可加 Tailwind/Base UI |
| API | Node.js + Fastify（或当前骨架的原生 HTTP） | 统一 JSON API、SSE、WebSocket、鉴权与计量 |
| 编排 | Durable workflow / queue + PostgreSQL | 任务可恢复、重试、幂等、断线续接 |
| 事件 | Redis Streams 或 NATS JetStream | 事件持久化后的实时 fan-out |
| 执行 | gVisor/Kubernetes，必要时 Firecracker | 不把不可信代码放进 API 进程 |
| 模型 | Provider adapter（OpenAI/Anthropic/自托管） | 模型路由、成本和降级策略隔离 |
| 数据 | PostgreSQL + S3/MinIO + Redis | 事务数据、工件、短期状态分别存储 |
| 可观测性 | OpenTelemetry + Prometheus/Grafana + Loki | TTFT、任务成功率、工具失败率和成本 |
| 交付 | Docker 开发环境，生产按区域部署 | 先单区跑通，再做多区域和支付本地化 |

## 第一阶段（必须跑通的闭环）

1. 用户创建任务并得到稳定 `runId`。
2. Worker 在隔离 workspace 中调用一个模型和四类基础工具：搜索、浏览器、Shell、文件读写。
3. 事件以可重放 SSE 发送，刷新页面或网络恢复后从序号继续。
4. 任务状态、事件和文件元数据持久化；文件通过签名 URL 下载。
5. 额度按实际 provider usage 记账，失败和取消可审计。

不应在第一阶段同时做团队、技能市场、复杂回放、微信支付和多模型矩阵。它们会扩大权限、计量和运维风险，但不会帮助验证最重要的运行时闭环。

## 管理层资源判断

最小可上线团队：1 名全栈负责人、1 名执行运行时/基础设施工程师、1 名产品前端工程师，外加兼职安全和设计。单区 MVP 的主要成本不是前端，而是沙箱、模型调用、持久队列、文件存储和观测。

推荐先做 6-8 周内部 alpha，再决定是否投入团队、计费和多区域。任何“1:1”承诺都应理解为功能和工作流等价，不是复制第三方受保护实现。

## 立即开工

```powershell
cd E:\0_Code\OpenRigor
corepack enable
pnpm install
pnpm dev:api       # 终端 1，8787
pnpm dev:web       # 终端 2，5173
```

接着按 [ROADMAP.md](ROADMAP.md) 的 M1 顺序推进：协议测试 -> PostgreSQL 事件表 -> 队列 worker -> sandbox provider -> 文件工件 -> 鉴权/计量。

## 风险与边界

- 当前 executor 是确定性的 demo，不执行用户代码，也不代表生产隔离已经完成。
- 调研结论是 2026-08-09 的公开页面快照；价格、构建资源和区域配置会变化。
- 不应复制 ClawsGO/AICSS 的商标、源码、文案、截图或独有视觉资产；第三方组件须逐项核对许可证。
- 生产上线前必须完成租户隔离、SSRF 防护、命令白名单/资源限额、密钥不进入沙箱、审计日志和数据删除流程。
