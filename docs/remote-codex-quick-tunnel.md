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

## 7. 手机 App 填写项

在 `app-codexapp` 连接页填写：

- 服务地址：`wss://你的随机地址.trycloudflare.com`
- Relay Token：`C:\Users\<你的用户名>\.codex\app-server\relay.token` 的内容

不要填写 `mobile.token`，也不需要手动将 `relay_token` 拼接到 URL；客户端会自动处理。

先运行健康检查，成功后再点击连接。

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

## 10. 排障顺序

按以下顺序检查。在哪一步失败，问题就位于该层或其上游。

```powershell
# Windows 本机 Relay
curl.exe --max-time 5 http://127.0.0.1:4501/readyz
```

```bash
# 服务器 SSH 反向隧道
curl --max-time 5 http://127.0.0.1:4501/readyz
```

```bash
# Cloudflare 公网入口
curl --max-time 20 https://你的地址.trycloudflare.com/readyz
```

如果本机和服务器均返回 `ok`，但公网失败，检查服务器的 `cloudflared` 进程和日志：

```bash
pgrep -af '[c]loudflared'
tail -n 80 /tmp/codex-mobile-cloudflared.log
```

## 参考

- [OpenAI Docs：Codex App Server](https://learn.chatgpt.com/docs/app-server.md)
- [Cloudflare Docs：设置 Tunnel](https://developers.cloudflare.com/tunnel/setup/)
