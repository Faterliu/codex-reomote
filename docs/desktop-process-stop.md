# 关闭桌面端并让手机接着使用对话

## 从手机关闭

手机 App 的「设置 → 电脑端控制 → 关闭桌面端」可以执行同一个脚本。先连接需要控制的电脑，确认提示后等待关闭结果，再在手机重新打开原对话。

需要安装包含该按钮的新客户端，并重启电脑端 Relay 以加载新接口。原有连接网址和 Relay token 可以继续使用；手机直接连接 App Server 时不支持此操作。更新文件不会改变正在运行的旧 Relay。

Relay 提供 `POST /desktop/stop`，通过 `Authorization: Bearer <relay token>` 鉴权。未配置 token、token 错误、非 POST 和非 Windows 环境均不会执行脚本。接口只执行仓库内固定的关闭脚本，不接受命令或脚本路径参数；同一时间只允许一次关闭操作。手机不需要先恢复对话，因此对话出现 `active writer` 时仍可以使用。

## 从手机重启 App Server

「设置 → 电脑端控制 → 重启 App Server」通过同样的 Relay token 鉴权调用 `POST /app-server/restart`，执行 `restart-phone-tunnel.ps1 -LocalOnly`。端口和 token 文件由电脑端 Relay 配置决定，手机不能指定脚本、端口或文件路径。

此模式只重启本机 WebSocket App Server，不重启 Relay，不检查或修改旧的 SSH 隧道和固定公网地址。重启会中断该 App Server 上正在执行的任务，手机 WebSocket 会短暂断开；HTTP 请求由保持运行的 Relay 返回结果，成功后手机自动重新连接，用户再打开原对话。仅允许 Windows 本机 TCP 上游，Unix socket 或远程上游不支持此按钮。关闭桌面端和重启服务共享执行锁，不能同时运行。

电脑端直接执行 `restart-phone-tunnel.ps1`（不带 `-LocalOnly`）仍保留原有完整链路检查行为。重启按钮需要更新手机客户端和重启 Relay 后才能使用。

App Server 已断开或停止时，按钮仍使用最近一次连接的 Relay 地址和 token；不要求 WebSocket 已连接。首次使用需在连接页填写 Relay 配置并点击连接，即使连接失败也可以使用重启按钮。设置页显示操作目标的主机名，不显示 token。Relay 或公网通道本身停止时，手机无法发送控制请求，需要在电脑端恢复链路。

## 从电脑关闭

双击 `scripts/stop-codex-desktop.bat`，或在仓库根目录执行：

```powershell
# 只列出准备关闭的进程。
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-codex-desktop.ps1 -WhatIf

# 关闭桌面端及其后端进程。
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-codex-desktop.ps1
```

脚本按 Windows 商店版 `OpenAI.Codex` 的安装路径识别桌面端，兼容当前桌面程序名 `ChatGPT.exe`。它也清理安装目录中的 `codex.exe` 和 `codex-code-mode-host.exe` 残留，不按 `codex.exe` 名称批量结束进程。

手机 App Server（默认 4500）、Relay（默认 4501）及其相关启动进程受到保护。脚本不删除数据库或锁文件，不修改 token，不重启手机服务。桌面端已关闭时，重复执行会直接提示没有需要清理的桌面进程。

关闭采用强制结束进程，会中断桌面端正在进行的工作。建议当前轮次完成后再运行。关闭后，在手机端重新打开原对话继续使用；脚本不将桌面端正在生成的任务无缝转移到手机。

## 本机验证结果

- 在桌面端已关闭时执行预览与关闭，手机服务未被结束。
- 临时启动真实桌面程序，再运行脚本，桌面进程退出；4500、4501 的监听 PID 保持不变。
- 在 4512 临时启动桌面版附带的后端，恢复一个此前报冲突的空闲对话，复现手机后端的 `already has an active writer`。
- 脚本结束该桌面后端后，手机后端恢复同一对话成功；测试没有发送新消息，随后解除测试订阅。
- 临时桌面程序、测试后端与测试连接已退出，4512 不再监听。
- 新增手机入口后，使用手机端请求模块访问临时 Relay（4513）进行实际验证：未鉴权的请求返回 403，鉴权通过后真实桌面程序退出，手机服务的监听 PID 保持不变；随后停止临时 Relay。
- 已通过移动端类型检查，以及接口鉴权、并发关闭、错误反馈和手机请求兼容性测试。
- 重启入口在临时 App Server（4514）和临时 Relay（4513）上实测：未鉴权请求被拒绝；鉴权后服务 PID 改变，Relay PID 不变，旧 WebSocket 断开，新 WebSocket 初始化成功。当前 4500/4501 服务 PID 未变，测试进程随后清理。
- 完全停止临时 App Server 后，仍能通过临时 Relay 调用重启接口启动服务并重新连接 WebSocket；占用临时端口的其他程序会使脚本拒绝重启，原程序保持运行。

验证覆盖桌面程序关闭与后端写入锁释放；尚未进行手机真机操作验证。
