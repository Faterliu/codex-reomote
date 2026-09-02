# 通过服务器和 Cloudflare Tunnel 远程使用 Codex

本方案让 Codex 与项目文件始终运行在 Windows 本机；公网服务器只承担 SSH 反向隧道与 Cloudflare Tunnel 的中继职责。

> Codex App Server 的 WebSocket 模式属于实验性能力。公网访问必须使用 TLS，并启用认证。

## 架构

```text
手机 App
  ↓ WSS
Cloudflare Quick Tunnel / Named Tunnel
  ↓
服务器 127.0.0.1:4501
  ↓ SSH 反向隧道
Windows 本机 127.0.0.1:4501 Relay
  ↓
Windows 本机 127.0.0.1:4500 Codex App Server
  ↓
本机项目、Codex 会话与工具
```

公网流量不会直接访问 Codex App Server 的 4500 端口。

## 1. 准备条件

### Windows 本机

确认 Node.js、pnpm 与 Codex CLI 可用：

```powershell
node --version
pnpm --version
codex --version
codex app-server --help
```

安装 `app-codexapp`：

```powershell
cd C:\file
git clone https://github.com/vjzning/app-codexapp.git
cd C:\file\app-codexapp
pnpm install
```

### 远程服务器

服务器需要满足：

- 可从本机 SSH 登录，例如 `root@8.148.73.94`；
- 已安装 `cloudflared`；
- SSH 服务允许 TCP 转发。

检查 SSH 转发配置：

```bash
sshd -T | grep -E 'allowtcpforwarding|gatewayports'
```

其中必须有：

```text
allowtcpforwarding yes
```

本方案将反向端口绑定到服务器 `127.0.0.1`，因此不需要对公网开放 4501。

## 2. 创建 Token（仅首次）

在 Windows PowerShell 创建目录和两个独立 token：

```powershell
$tokenDir = "$env:USERPROFILE\.codex\app-server"
New-Item -ItemType Directory -Force $tokenDir

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()

$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
$mobile = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
Set-Content -NoNewline -Encoding utf8 "$tokenDir\mobile.token" $mobile

$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
$relay = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
Set-Content -NoNewline -Encoding utf8 "$tokenDir\relay.token" $relay
```

| 文件 | 用途 | 是否填到手机 |
| --- | --- | --- |
| `mobile.token` | Relay 访问 Codex App Server 的上游凭据 | 否 |
| `relay.token` | 手机访问 Relay 的凭据 | 是 |

不要将 token 提交到 Git、写进脚本或分享给他人。

## 3. 启动本机 Codex App Server

在项目目录或希望让 Codex 操作的项目目录中运行：

```powershell
codex app-server `
  --listen ws://127.0.0.1:4500 `
  --ws-auth capability-token `
  --ws-token-file "$env:USERPROFILE\.codex\app-server\mobile.token"
```

App Server 只监听 `127.0.0.1:4500`，不会直接暴露到局域网或公网。

## 4. 启动本机 Relay

另开一个 PowerShell：

```powershell
cd C:\file\app-codexapp

$env:RELAY_LISTEN_HOST = "127.0.0.1"
$env:RELAY_LISTEN_PORT = "4501"
$env:RELAY_TOKEN = (
  Get-Content "$env:USERPROFILE\.codex\app-server\relay.token" -Raw
).Trim()
$env:UPSTREAM_WS_URL = "ws://127.0.0.1:4500"
$env:UPSTREAM_TOKEN_FILE = "$env:USERPROFILE\.codex\app-server\mobile.token"

node scripts\app-server-relay.mjs
```

验证本机 Relay：

```powershell
curl.exe --max-time 5 http://127.0.0.1:4501/readyz
```

正常响应：

```text
ok
```

### Relay 监听异常检查

Relay 正常情况下应只监听：

```text
127.0.0.1:4501
```

检查当前 4501 端口监听情况：

```powershell
Get-NetTCPConnection -LocalPort 4501 -State Listen |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

如果同时出现：

```text
127.0.0.1:4501
0.0.0.0:4501
```

或者存在多个不同 PID 监听 4501，说明可能存在旧 Relay、重复启动脚本或其他残留进程。继续查询实际进程：

```powershell
Get-CimInstance Win32_Process |
Where-Object {$_.ProcessId -in (
  Get-NetTCPConnection -LocalPort 4501 -State Listen
).OwningProcess} |
Select-Object ProcessId,Name,CommandLine
```

正常情况下，4501 应由当前 `node scripts\app-server-relay.mjs` 对应的进程监听。确认某个 PID 为旧 Relay 后，可单独停止：

```powershell
Stop-Process -Id <旧PID>
```

不要直接结束所有 `node.exe`，避免误杀其他 Node.js 程序。

## 5. 建立 SSH 反向隧道

另开一个 PowerShell：

```powershell
ssh.exe -N `
  -o ExitOnForwardFailure=yes `
  -o ServerAliveInterval=30 `
  -o ServerAliveCountMax=3 `
  -R 127.0.0.1:4501:127.0.0.1:4501 `
  root@8.148.73.94
```

这条命令建立以下映射：

```text
服务器 127.0.0.1:4501 → Windows 本机 127.0.0.1:4501
```

在服务器验证：

```bash
ss -ltnp | grep ':4501'
curl --max-time 5 http://127.0.0.1:4501/readyz
```

监听地址应为 `127.0.0.1:4501`，健康检查应返回 `ok`。

## 6. 服务器启动 Cloudflare Quick Tunnel

在服务器运行：

```bash
nohup /usr/local/bin/cloudflared tunnel \
  --url http://127.0.0.1:4501 \
  > /tmp/codex-mobile-cloudflared.log 2>&1 < /dev/null &
```

读取 Quick Tunnel 地址：

```bash
grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' \
  /tmp/codex-mobile-cloudflared.log | tail -n 1
```

验证公网入口：

```bash
curl --max-time 20 https://你的随机地址.trycloudflare.com/readyz
```

正常响应：

```text
ok
```

Quick Tunnel 每次 `cloudflared` 进程重启都会生成新的随机地址。长期使用固定地址时，应改用 Cloudflare Named Tunnel 和自有域名。

### Quick Tunnel 旧地址异常

手机 App 可能会恢复上一次保存的连接配置。如果服务器上的 `cloudflared` 已重启，而手机仍使用旧的 `trycloudflare.com` 地址，可能出现 `524`、连接超时或持续处于 `connecting` 状态。

发生此类情况时：

1. 在服务器重新读取当前 Quick Tunnel 地址；
2. 在手机 App 中清除旧的保存配置；
3. 填入新的 `wss://...trycloudflare.com` 地址；
4. 重新执行 `readyz` 检查后再连接。

不要仅依赖手机 App 自动恢复的旧地址。

## 7. 手机 App 填写项

在 `app-codexapp` 连接页填写：

- 服务地址：`wss://你的随机地址.trycloudflare.com`
- Relay Token：`C:\Users\<你的用户名>\.codex\app-server\relay.token` 的内容

不要填写 `mobile.token`，也不需要手动将 `relay_token` 拼接到 URL；客户端会自动处理。

先运行健康检查，成功后再点击连接。若手机显示“已恢复保存的连接配置”，应确认其中的 Quick Tunnel 地址仍是服务器当前正在使用的地址。

## 8. 本机开机自动恢复

项目包含本机启动脚本：

```text
scripts\start-phone-tunnel.ps1
```

本机启动或连接断开后运行：

```powershell
powershell -ExecutionPolicy Bypass -File C:\file\app-codexapp\scripts\start-phone-tunnel.ps1
```

脚本会：

1. 启动或复用本机 Codex App Server；
2. 启动或复用本机 Relay；
3. 启动或复用 SSH 反向隧道；
4. 验证服务器的 `127.0.0.1:4501/readyz`；
5. 输出服务器当前记录的 Quick Tunnel 地址。

推荐使用 Windows 任务计划程序设置为：

- 触发器：登录时；
- 延迟任务：1 分钟；
- 失败后：每分钟重试，最多 3 次；
- 若任务已在运行：不启动新实例。

该脚本不重启服务器上的 `cloudflared` Quick Tunnel。

## 9. 重启与恢复规则

| 情况 | 地址 / Token | 恢复操作 |
| --- | --- | --- |
| Windows 本机重启 | Quick Tunnel 地址和 Relay Token 不变 | 重新运行本机启动脚本 |
| 本机网络断开 | 地址和 Token 不变 | 网络恢复后重新运行本机启动脚本 |
| 服务器重启 | Quick Tunnel 通常停止 | 重启服务器端 `cloudflared`，并重新运行本机启动脚本 |
| `cloudflared` 重启 | Quick Tunnel 地址改变，Relay Token 不变 | 更新手机服务地址 |

## 10. 推荐启动与关闭顺序

### 启动顺序

为避免多个故障同时叠加，建议按以下顺序启动：

```text
1. Windows：Codex App Server
2. Windows：Relay
3. Windows：验证 127.0.0.1:4501/readyz
4. Windows：建立 SSH 反向隧道
5. 服务器：验证 127.0.0.1:4501/readyz
6. 服务器：启动 cloudflared
7. 公网：验证 https://当前地址.trycloudflare.com/readyz
8. 执行 WebSocket probe
9. 手机 App 连接
```

不要在前一层尚未验证正常时直接跳到手机端测试。

### 关闭顺序

推荐：

```text
1. 手机 App 断开
2. 停止服务器 cloudflared
3. 停止 SSH 反向隧道
4. 停止 Relay
5. 停止 Codex App Server
```

## 11. 正常运行状态基线

出现故障前先与以下正常状态进行比较：

| 层级 | 正常状态 |
| --- | --- |
| Codex App Server | `127.0.0.1:4500` 处于 `Listen` |
| Relay | 仅 `127.0.0.1:4501` 处于 `Listen` |
| Windows `/readyz` | 立即返回 `ok` |
| 服务器 4501 | `127.0.0.1:4501` 处于监听 |
| 服务器 `/readyz` | 立即返回 `ok` |
| Cloudflare `/readyz` | 返回 `ok` |
| WebSocket probe | 返回 `"ok": true` |
| 手机 App | 状态为已连接而非持续 `connecting` |

## 12. 排障顺序

按以下顺序检查。不要跳层排查；在哪一步首次失败，问题通常就位于该层。

### 12.1 Codex App Server

Windows：

```powershell
Get-NetTCPConnection -LocalPort 4500 -State Listen
```

应能看到 `127.0.0.1:4500` 监听。如果没有，重新启动 Codex App Server。

### 12.2 Windows 本机 Relay

```powershell
curl.exe --max-time 5 -i http://127.0.0.1:4501/readyz
```

应在数秒内返回：

```text
HTTP/1.1 200 OK
...
ok
```

如果长时间无响应，不要继续测试服务器或手机，先检查 4501 的监听进程及是否存在重复 Relay。

### 12.3 服务器 SSH 反向隧道

```bash
ss -ltnp | grep ':4501'
curl --max-time 5 -i http://127.0.0.1:4501/readyz
```

如果 Windows 本机返回 `ok`，但服务器失败，则优先检查 SSH 反向隧道是否断开、旧隧道是否残留，以及当前服务器 4501 是否确实由 SSH 转发监听。

必要时重新建立隧道：

```powershell
ssh.exe -N `
  -o ExitOnForwardFailure=yes `
  -o ServerAliveInterval=30 `
  -o ServerAliveCountMax=3 `
  -R 127.0.0.1:4501:127.0.0.1:4501 `
  root@8.148.73.94
```

### 12.4 Cloudflare 公网入口

```bash
curl --max-time 20 -i https://你的地址.trycloudflare.com/readyz
```

如果本机和服务器均返回 `ok`，但公网失败，检查服务器的 `cloudflared` 进程和日志：

```bash
pgrep -af '[c]loudflared'
tail -n 80 /tmp/codex-mobile-cloudflared.log
```

### 12.5 WebSocket 完整链路

`/readyz` 成功只表示 HTTP 健康检查正常，还需要验证 WebSocket、Relay Token 和 Codex App Server 协议链。

Windows：

```powershell
$relay = (
  Get-Content "$env:USERPROFILE\.codex\app-server\relay.token" -Raw
).Trim()

$env:CODEX_APP_SERVER_URL = "wss://你的当前地址.trycloudflare.com?relay_token=$relay"

node scripts\probe-app-server.mjs
```

正常情况下应看到：

```text
"ok": true
```

如果公网 `/readyz` 正常，但 probe 失败，则优先排查：

- `relay.token` 是否正确；
- Relay 是否能连接 `127.0.0.1:4500`；
- `mobile.token` 是否与 App Server 启动时使用的 token 一致；
- App Server 是否仍在运行；
- 当前填写的 Quick Tunnel 地址是否已过期。

### 12.6 常见异常现象对照表

| 现象 | 通常含义 | 优先排查 |
| --- | --- | --- |
| 根路径 `/` 显示 `not found` | Relay 未提供网页根路径，通常不是故障 | 使用 `/readyz` 检查 |
| `502 Bad Gateway` | Cloudflare 无法正常访问配置的源站 | `cloudflared`、服务器 `127.0.0.1:4501` |
| `524` | Cloudflare 已建立连接，但后端长时间未返回 | SSH 反向隧道、卡死 Relay、手机使用旧 Quick Tunnel 地址 |
| `403` | Relay 认证失败 | `relay.token` |
| `Connection refused` | 对应端口没有程序监听 | Relay、App Server 或 SSH 转发 |
| TLS 建立前断开 | 域名错误、Quick Tunnel 地址失效或网络异常 | 当前 `trycloudflare.com` 地址、`cloudflared` 状态 |
| Windows `/readyz` 长时间无响应 | 4501 监听进程异常或存在冲突 | 4501 PID、重复 Relay |
| Windows `ok`，服务器失败 | SSH 反向隧道异常 | SSH 进程、服务器 4501 监听 |
| 服务器 `ok`，公网失败 | Cloudflare Tunnel 层异常 | `cloudflared` 进程与日志 |
| 公网 `ok`，probe 失败 | HTTP 正常但 WebSocket/认证/App Server 异常 | token、Relay 上游、App Server |
| 公网 `ok`，手机仍无法连接 | 手机配置或缓存异常 | 清除保存配置并填入当前 Quick Tunnel 地址 |

### 12.7 分层判断树

```text
Codex App Server 4500 是否监听？
        │
        ├─ 否 → App Server 问题
        │
        ▼
Windows 4501 /readyz 是否 ok？
        │
        ├─ 否 → Relay / 端口冲突问题
        │
        ▼
Server 4501 /readyz 是否 ok？
        │
        ├─ 否 → SSH Reverse Tunnel 问题
        │
        ▼
trycloudflare /readyz 是否 ok？
        │
        ├─ 否 → cloudflared / Quick Tunnel 问题
        │
        ▼
probe-app-server 是否 ok？
        │
        ├─ 否 → WebSocket / Token / App Server 协议问题
        │
        ▼
手机是否正常连接？
        │
        ├─ 否 → 手机 URL / 缓存配置 / App 问题
        │
        ▼
成功
```

## 参考

- [OpenAI Docs：Codex App Server](https://learn.chatgpt.com/docs/app-server.md)
- [Cloudflare Docs：设置 Tunnel](https://developers.cloudflare.com/tunnel/setup/)
