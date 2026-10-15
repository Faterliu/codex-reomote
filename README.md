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
pnpm release:android -Version 1.1.3 -VersionCode 10  -ChangelogFile .\release-notes.txt

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

Windows 日常使用以下入口：

```powershell
.\scripts\start-phone-tunnel.bat
```

该脚本启动或复用本机 App Server（4500）和 Relay（4501），监控既有 SSH 反向转发及配置的公网连接，并在故障时自动恢复。重复双击会立即执行一次检查和修复。

手动重启 App Server 或停止本机链路：

```powershell
.\scripts\restart-phone-tunnel.bat
.\scripts\stop-phone-tunnel.bat
```

自动恢复与只读检查见 [手机链路自动恢复](docs/phone-tunnel-recovery.md)。Cloudflare Tunnel 需单独管理，脚本不会自动启动 cloudflared，配置见 [Cloudflare Tunnel 接入](docs/cloudflare-tunnel.md)。

## 手动调试

只在本机调试协议时，可以单独启动 app-server：

```bash
codex app-server --listen ws://127.0.0.1:4500
```

再用探测脚本验证：

```bash
CODEX_APP_SERVER_URL=ws://127.0.0.1:4500 pnpm probe:app-server
```

真机连接使用上述 Windows 启动入口，通过 Relay 处理 WebSocket token。

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

[v1.0.3] 20261008
1. 增加账号记录保持功能。
2. 取消“清除当前连接”，避免误操作。

[v1.0.4] 20261010
1. 增加手机端关闭电脑端codex、重启电脑端app-server的按钮。

[v1.0.5] 20261015
1. 优化启动脚本的断联恢复能力。
