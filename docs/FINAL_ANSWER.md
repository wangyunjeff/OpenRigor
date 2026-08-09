# Final handoff — 2026-08-09

jeff，`OpenRigor` 已经从调研骨架推进到可直接使用的本地 Codex alpha，公开项目地址：

<https://github.com/wangyunjeff/OpenRigor>

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

打开 <http://127.0.0.1:5173>。默认沙箱为 `workspace-write`，Codex 可以在这个仓库中工作；只想检查、不允许改文件时，先设置：

```powershell
$env:OPENRIGOR_CODEX_SANDBOX = "read-only"
pnpm dev:codex
```

本轮已经真实验证：`codex-cli 0.146.0` 的 initialize/thread/turn 链路、浏览器 SSE 流式 `OK` 回复、只读 Shell 工具事件、usage、运行中取消、类型检查、单元测试和生产构建。

当前边界也很清楚：这是单用户、单工作区、进程内存版本。刷新期间 SSE 可以重放，但 API 重启后记录会丢失；附件、交互审批、同线程追问、持久历史和远程服务器尚未实现。下一步按 `docs/ROADMAP.md` 做 PostgreSQL 事件表与恢复，再补多轮对话和审批，不先扩团队、计费或云主机。
