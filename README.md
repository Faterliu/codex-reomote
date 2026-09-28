# Codex Mobile Remote

原作者：https://github.com/vjzning/app-codexapp

Codex App Server 移动端客户端。它把手机 App 当作一个 Codex UI surface，连接你显式启动的 `codex app-server`，用于查看会话、继续发送消息、接收事件和处理审批。
# 指令
## 启动脚本
powershell -ExecutionPolicy Bypass -File C:\file\app-codexapp\scripts\start-phone-tunnel.ps1

## 重启脚本
powershell -ExecutionPolicy Bypass -File C:\file\app-codexapp\scripts\restart-phone-tunnel.ps1

## 本地cloudflared通道
& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' tunnel --protocol http2 --url http://127.0.0.1:4501

## 显式指定新版本和 UTF-8 更新记录，然后打包、校验、上传并发布。
pnpm release:android -Version 1.0.3 -VersionCode 4 -ChangelogFile .\release-notes.txt

## 预览

<p>
  <img src="./docs/images/chat-detail-preview.jpg" alt="会话详情界面" width="260" />
  <img src="./docs/images/connection-preview.jpg" alt="连接管理界面" width="260" />
  <img src="./docs/images/thread-list-preview.jpg" alt="会话列表界面" width="260" />
</p>

## 目录

```text
apps/mobile/        Expo React Native 客户端
packages/protocol/  codex app-server generate-ts 生成的协议类型
docs/               本地启动说明
```

## 开发命令

```bash
pnpm install
pnpm typecheck
pnpm mobile
```

说明：

- `pnpm mobile` 默认固定使用 Expo Metro 端口 `8097`
- 这是前端打包端口，不是 Codex WebSocket 的 `4500 / 4501`

重新生成协议类型：

```bash
pnpm protocol:generate
```

## 发布 Android APK

项目使用 GitHub Actions 自动构建 Android release APK。

打一个 `v*` tag 并推送后，GitHub 会自动构建 APK，并上传到对应 GitHub Release：

```bash
git tag v0.1.0
git push origin v0.1.0
```

也可以在 GitHub Actions 页面手动运行 `Android Release APK` workflow。手动运行只会生成 workflow artifact，不会创建 Release。

## 一键启动

### 本地局域网

```bash
pnpm start:lan
```

这个命令会同时启动：

- `codex app-server`：监听 `127.0.0.1:4500`
- 本地 relay：监听 `0.0.0.0:4501`
- 终端二维码：手机 App 扫码后自动填入 URL 和 relay token

首次运行会自动生成：

```text
~/.codex/app-server/mobile.token
~/.codex/app-server/relay.token
```

手机和电脑必须在同一个 Wi-Fi / 局域网。如果自动识别的 IP 不对，可以手动指定：

```bash
CODEX_MOBILE_LAN_HOST=192.168.1.23 pnpm start:lan
```

### 外网 Cloudflare

先创建 Cloudflare Tunnel 配置：

```bash
mkdir -p ~/.cloudflared
cp docs/cloudflare-tunnel.yml.example ~/.cloudflared/codex-mobile.yml
```

把 `~/.cloudflared/codex-mobile.yml` 里的 `tunnel`、`credentials-file`、`hostname` 改成你自己的值，然后启动：

```bash
PUBLIC_CODEX_MOBILE_URL=wss://your-domain.example.com pnpm start:cloudflare
```

这个命令会同时启动：

- `codex app-server`：监听 `127.0.0.1:4500`
- 本地 relay：监听 `127.0.0.1:4501`
- `cloudflared tunnel`
- 终端二维码：手机 App 扫码后自动填入公网 URL 和 relay token

公网只暴露 relay，不要直接暴露裸 `4500`。详细配置见 [docs/cloudflare-tunnel.md](docs/cloudflare-tunnel.md)。

### 电脑端与手机共用同一 App Server

如果希望手机能可靠回答电脑端已启动任务的计划模式询问，需要让电脑端和手机连接**同一个** app-server，避免两个独立 App Server 竞争同一 thread 的写入权（报 `already has an active writer`）。

```bash
pnpm start:shared
```

这个命令会：

- 复用 `127.0.0.1:4500` 上已有的 app-server；若没有就启动一个（`--ws-auth capability-token`）。
- 启动本地 relay（`4501` → `4500`），手机扫码即可连接。
- 打印电脑端接入命令，电脑端改用 CLI 接入同一 app-server，**不要**再开 Codex Desktop App：

```powershell
$env:CODEX_REMOTE_TOKEN = (Get-Content "$env:USERPROFILE\.codex\app-server\mobile.token" -Raw).Trim()
codex --remote ws://127.0.0.1:4500 --remote-auth-token-env CODEX_REMOTE_TOKEN
```

外网场景设置 `PUBLIC_CODEX_MOBILE_URL` 即进入 Cloudflare 模式（relay 只监听 `127.0.0.1` 并启动 `cloudflared`）：

```bash
PUBLIC_CODEX_MOBILE_URL=wss://your-domain.example.com pnpm start:shared
```

注意：此方案不保留 Codex Desktop App 原生 GUI，电脑端操作在终端 CLI 里完成；手机端能否回答电脑端任务在计划模式下发起的询问，仍需真机联调验证（依赖手机端已有的强制 `thread/resume` 重新附加逻辑）。

## 手动调试

只在本机调试协议时，可以单独启动 app-server：

```bash
codex app-server --listen ws://127.0.0.1:4500
```

再用探测脚本验证：

```bash
CODEX_APP_SERVER_URL=ws://127.0.0.1:4500 pnpm probe:app-server
```

真机连接建议优先使用 `pnpm start:lan` 或 `pnpm start:cloudflare`，它们会通过 relay 处理 WebSocket token。

## 当前能力

- 连接 WebSocket App Server
- 初始化 JSON-RPC 会话
- 列出最近 thread
- 读取 thread turns/items
- 给已选 thread 发送 `turn/start`
- 展示实时 notification
- 展示命令/文件变更 approval，并支持允许一次、本会话允许、拒绝

## 注意

这是协议验证版，不直接控制 Codex Desktop App 窗口。它应连接你显式启动的 `codex app-server`。

## License

MIT

# 更新说明
[v1.0.0] 20260911
1. 修复App Server 将同一个 thread.id 返回多次的问题。
2. 增加手机界面额度显示、思考程度选择的功能。

[v1.0.1] 20260914
1. 增加新分支功能。
2. 增加服务端 QUIC 传输频繁超时提示显示。

[v1.0.2] 20260928
1. 增加更新检测功能
