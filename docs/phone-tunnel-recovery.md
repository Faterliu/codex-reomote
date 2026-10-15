# 手机链路自动恢复

双击 `scripts/start-phone-tunnel.bat` 启动后台监控。已有监控器时，重复双击会立即执行一次检查和修复，不再直接退出；同一时间只运行一个监控器，修复操作也通过互斥锁串行执行。

自动恢复逻辑统一放在 `scripts/start-phone-tunnel.ps1` 中，重启入口保留在 `scripts/restart-phone-tunnel.ps1`。WebSocket 初始化探测由 `scripts/phone-tunnel-probe.mjs` 执行。

监控默认每 60 秒检查一次，同一组件连续失败两次后执行恢复。检查会使用现有 token 完成 WebSocket 鉴权和 App Server 的 `initialize` 请求，不仅判断端口或 WebSocket 握手是否成功；不会恢复对话或发送聊天消息。

- App Server 停止时启动新实例；端口还在监听但初始化持续超时时，仅重启能确认属于本项目的 App Server。
- Relay 停止或无响应时，启动或重启本项目 Relay；健康的 App Server 保持运行。
- SSH 不可达时保留本机服务，等待网络恢复；反向转发异常时，只关闭与当前服务器及转发参数一致的本机 SSH 进程，等待远端端口释放后重建。
- 本机与服务器侧 Relay 正常，但公网初始化失败时，记录为公网故障并继续检查，不反复重启健康的 App Server。
- token、协议配置错误或无法确认归属的监听器不会触发强制停止。每个本机服务的自动重启都有三分钟冷却时间。

服务器端口仍被无法确认归属的旧连接或其他进程占用时，等待最多 30 秒，然后记录原因、在之后的检查中重试；不会停止服务器进程或修改服务器配置。电脑完全断网或公网反向代理异常时，本机脚本无法立即修复外部服务。

`restart-phone-tunnel.ps1` 与监控器共用修复锁，避免手机重启和自动恢复同时争抢端口。

只读检查当前链路：

```powershell
.\scripts\start-phone-tunnel.ps1 -CheckOnly
```

立即执行一次完整检查/恢复：

```powershell
.\scripts\start-phone-tunnel.ps1 -Once
```

`-LocalOnly` 跳过 SSH 与公网检查；`-TokenRoot`、`-RuntimeRoot` 和自定义端口支持隔离验证，不应指向其他服务使用的端口。

日志位于 `%LOCALAPPDATA%\CodexMobilePhoneTunnel\logs\watcher.log`，记录失败组件、原因和实际恢复操作。自动重启时间记录在运行目录的 `recovery-4500-4501.json` 中；token 不写入日志。

类型检查：

```powershell
pnpm typecheck
```

2026-10-14 已在 4533/4534 隔离端口使用虚构 token 完成真实进程验证，确认无响应服务能恢复、连续两次失败触发自动修复、重复启动立即检查。验证结束后已清理测试进程；临时测试文件已移除。
