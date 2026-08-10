# Final handoff — 2026-08-10

jeff，`OpenRigor` 已经是一套可直接使用的本地 Codex alpha，公开项目地址：

<https://github.com/wangyunjeff/OpenRigor>

本轮把运行设置升级成 Codex 风格的统一菜单：`GPT-5.6 Sol / Terra / Luna / Auto`，以及 `Low / Medium / High / XHigh / Max`。Ultra 作为独立的多 Agent 模式存在，只允许显式选择 Sol/Terra；Luna 的上限是 Max。前后端使用同一能力矩阵，旧版 `fast/balanced/deep/cluster` 请求仍可兼容。

界面现已支持 Light、Dark、System 三档主题并持久化选择。案例确认弹窗中的两张成果预览会从左右错层进入、轻微旋转落位并形成光影层次；重复打开会重新播放，系统要求减少动效时保持静态。整体继续采用 clean-room 设计，没有复制 ClawsGo 源码、品牌、截图或受保护素材。

后端仍直接连接本机已登录的 `codex app-server`：可以发送真实任务、在同一 Codex thread 上继续对话，并显示文本、reasoning、工具、命令输出、文件变化、状态和完成结果；停止按钮调用 `turn/interrupt`。云端路径及 ClawsGo 多运行时调查见 [CLOUD_RUNTIME_ARCHITECTURE.md](CLOUD_RUNTIME_ARCHITECTURE.md)。

本地使用：

```powershell
cd E:\0_Code\OpenRigor
corepack enable
pnpm install
codex login status
pnpm smoke:codex
pnpm dev:codex
```

标准入口是 Web <http://127.0.0.1:5173>、API <http://127.0.0.1:8787>。本轮保留的验收服务正在 Web <http://127.0.0.1:5174>、API <http://127.0.0.1:8787> 运行。默认沙箱为 `workspace-write`；只读检查可先设置：

```powershell
$env:OPENRIGOR_CODEX_SANDBOX = "read-only"
pnpm dev:codex
```

本轮全仓验证通过：TypeScript、25 个单元测试（Protocol 6、API 6、Web 13）、生产构建、`git diff --check`，以及 Playwright 对 1440px 桌面端的主题、模型菜单、Luna/Ultra 限制、案例弹窗重开和 reduced-motion 检查。生产构建仍有单入口包超过 500 kB 的 Vite 性能提示，不影响当前本地 alpha。

Image 2 素材位已经完成设计方向和提示词，但本机 `gpt-image-2` 高质量请求实测返回上游 `401`，因此没有拿占位图或伪生成图顶替。下一步只需在本机配置一个有 GPT Image 权限的 `OPENAI_API_KEY`（不要提交到 Git，也不要发到聊天里），即可生成并筛选论文脉络与证据矩阵两张正式素材。

当前边界：单用户、单固定工作区、服务端进程内存。API/app-server 重启后 run 映射仍会丢失；附件、交互审批、服务端持久历史、远程沙箱和生产级租户隔离尚未完成。接下来优先做 PostgreSQL 事件表、outbox/worker、重放与 gVisor POC，而不是直接把本地登录态暴露成公网服务。
