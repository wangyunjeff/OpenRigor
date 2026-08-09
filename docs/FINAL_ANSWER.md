# Final handoff — 2026-08-10

jeff，`OpenRigor` 已经从调研骨架推进到可直接使用的本地 Codex alpha，公开项目地址：

<https://github.com/wangyunjeff/OpenRigor>

当前交付内容会提交到 `main`，包含桌面端视觉重构、案例预览确认、模型/effort 菜单、知识与技能选择、结构化执行时间线、最近任务回读，以及前后端提交幂等和异步竞态隔离。

现在的第一版不是假聊天框：后端直接启动本机已登录的 `codex app-server`，前端可以发送真实任务，并显示文本流、思考过程、工具调用、命令输出、文件变更、状态和完成结果；停止按钮会调用 `turn/interrupt`。界面按照已观察到的 ClawsGO 深色任务工作台结构做了 clean-room 实现，没有复制第三方源码、品牌、截图或受保护素材。

本地使用：

```powershell
cd E:\0_Code\OpenRigor
corepack enable
pnpm install
codex login status
pnpm smoke:codex
pnpm dev:codex
```

默认打开 <http://127.0.0.1:5173>（API 默认监听 <http://127.0.0.1:8787>）。本次验收实例因端口占用使用了 Web `5174` / API `8788`。默认沙箱为 `workspace-write`，Codex 可以在这个仓库中工作；只想检查、不允许改文件时，先设置：

```powershell
$env:OPENRIGOR_CODEX_SANDBOX = "read-only"
pnpm dev:codex
```

本轮已经真实验证：Codex app-server 的 initialize/thread/turn 链路、浏览器 SSE 流式回复、真实工具事件、Markdown、运行中取消、最近任务回读、案例“预览 -> 确认 -> 预填 -> 手动发送”、提交幂等、类型检查、API/协议单元测试和生产构建。最终烟测结果为 Codex `OPENRIGOR_READY`，HTTP/SSE 任务正常完成。

当前边界也很清楚：这是单用户、单工作区、本机 Codex、进程内存运行版本。浏览器只保存最近任务的 run 引用；API 重启后对应记录会丢失。附件、交互审批、同线程追问、服务端持久历史、远程服务器和生产级隔离尚未实现。下一步按 `docs/ROADMAP.md` 做 PostgreSQL 事件表与恢复，再补多轮对话、审批和受控 worker，不先扩团队、计费或云主机。
