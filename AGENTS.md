# AGENTS.md

这个仓库是 Codex App Server 的移动端远程客户端。后续 agent 进入仓库时，先按本文确认边界，再动代码。

## 项目结构

- `apps/mobile/`：Expo React Native 客户端。
- `packages/protocol/`：通过 `codex app-server generate-ts` 生成的协议类型。
- `scripts/`：本地 app-server relay、Cloudflare 启动、探测脚本。
- `docs/`：本地启动、Cloudflare Tunnel、App Server API 资料。

## 基本规则

1. 依赖管理默认使用 `pnpm`。
2. 修改代码后至少运行 `pnpm typecheck`。
3. 不要手改 `packages/protocol/src/**` 里的生成文件；协议变化请运行 `pnpm protocol:generate`。
4. 新增生产依赖前需要先解释用途、替代方案和选择原因，并等待用户确认。
5. 关键逻辑可以写中文注释，尤其是协议兼容、移动端限制、鉴权和重连逻辑。
6. 不要提交 `node_modules`、Expo 缓存、构建产物或本地 token。`.workbuddy/`（本地 agent 记忆与会话数据）已在 `.gitignore` 中，不要把它加回版本控制。
7. 这个客户端连接的是显式启动的 `codex app-server`，不是直接控制 Codex Desktop App 窗口。
8. In PowerShell, pass JSON via files/stdin or use `--%` with properly escaped quotes for native commands.

## 常用命令

```bash
pnpm install
pnpm typecheck
pnpm mobile
pnpm start:cloudflare
pnpm protocol:generate
```

说明：

- `pnpm mobile` 是 Expo Metro，默认端口是 `8097`。
- Codex App Server WebSocket 常见端口是 `4500`。
- 本地 relay 常见端口是 `4501`。

## 本机 APK 构建

构建工具位于：

- JDK 17：`C:\Users\liuzhuo\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\CodexAndroidBuild\jdk\jdk-17.0.20.1+1`
- Android SDK：`C:\Users\liuzhuo\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\CodexAndroidBuild\android-sdk`
- SDK 已包含 Android 36、Build Tools 36.0.0、NDK 27.1 和 CMake 3.22.1。

当前使用仓库根目录 `.npmrc` 中的 `node-linker=hoisted`，原地构建，不复制到 `C:\a`。
自动更新脚本：`scripts/release-android.ps1`，用法见 `docs/android-app-updates.md`。

```powershell
# 只读预检，不安装依赖、不编译、不上传。
pnpm release:android -CheckOnly

# 显式指定新版本和 UTF-8 更新记录，然后打包、校验、上传并发布。
pnpm release:android -Version 1.0.3 -VersionCode 4 -ChangelogFile .\release-notes.txt
```

脚本自动配置 JDK/SDK、安装锁定依赖、运行 typecheck、同步 Expo 原生配置，再执行 Gradle。
不使用 `prebuild --clean`，以保留现有签名文件；发布前比较线上 APK 的签名证书。
2026-09-28 已通过 Windows PowerShell 5.1 在原工作区完成 1.0.3（versionCode 4）的打包、上传和公网 SHA-256 校验。如果构建报错，脚本立即停止，不更新服务器清单。
不要把旧 `.pnpm` 布局的 `.cxx`、autolinking 或 Gradle 缓存复制回来。

### 产物校验与归档

- 归档到 `dist/`，命名 `codex-mobile-<特性>-<YYYYMMDD>.apk`，同一天的第二版加 `-r2` 之类后缀。`dist/` 已被 `.gitignore` 忽略。
- 签名：release buildType 继承 `signingConfigs.debug`，是 **v2 签名**。判断 v2 要解析 APK Signing Block
  （magic 位于 ZIP 中央目录前 16 字节），只看 `META-INF/*.RSA` 会把已签名的包误判成未签名。
- 声明「改动已生效」前，解出 `assets/index.android.bundle` 并搜索本次新增的**对象字面量属性名**
  （调用点里显式写出的 key）。Metro 压缩默认不改属性名，所以这类标识搜得到；局部变量名可能被改名，
  不要拿它当依据。这比只看「构建成功」可靠得多。

## 当前链路配置与远程服务器依赖（2026-09-29）

### 手机连接链路

- 当前采用本机 Tunnel 路径：Windows 本机 Codex App Server `127.0.0.1:4500` → Relay `127.0.0.1:4501` → 本机 `cloudflared`（强制 HTTP/2）→ 手机 App。手机实时连接不经过远程服务器上的 Cloudflare Tunnel。
- `start-phone-tunnel.bat` / `start-phone-tunnel.ps1` 仍会建立 SSH 反向隧道，并检查服务器 `127.0.0.1:4501/readyz`；这是旧路径 A 的兼容/排障链路，不能据此认为手机当前公网流量经过服务器。
- token 保存在 `%USERPROFILE%\.codex\app-server\`，禁止写入仓库或文档。
- `start-phone-tunnel.bat` 隐藏启动，并每 60 秒检查链路；连续失败 2 次后自动修复。
- `restart-phone-tunnel.bat` 仅重启 App Server，用于处理 `active writer` 等状态残留。
- `stop-phone-tunnel.bat` 停止本机监控器、App Server、Relay 和反向隧道，不停止服务器进程。

### 远程服务器当前状态及项目依赖

只读检查时间：`2026-09-29 10:15:41 +08:00`，服务器 `iZn4aetqy7dj6wsl6t9c7hZ`（`admin@8.148.73.94`）。下列状态是该时间点的现场快照。

本项目依赖且当时正在运行的远程服务：

- **`nginx.service`：active/running，监听 TCP 80 和 443。** 为 `updates.yinxingye.space` 提供 Android 更新清单和 APK；发布目录为 `/var/www/updates/apps/codexapp/`。App 内更新依赖此 HTTPS 文件服务。
- **`ssh.service`（`sshd`）：active/running，监听 TCP 22。** `scripts/release-android.ps1` 通过 SSH 连接 `admin@8.148.73.94`，检查发布目录并上传/发布 APK，因此发布流程依赖此服务。现场还看到服务器 `127.0.0.1:4501` 正在监听，符合 SSH 反向转发配置；该转发供旧路径和本机脚本检查使用，当前手机 Tunnel 路径不经过它。

现场没有发现远程 `cloudflared` 进程或运行中的 `cloudflared` systemd 服务；不要再记录服务器 Quick Tunnel 地址为当前地址。远程 `frps.service` 虽在运行，但仓库没有引用它，不属于本项目依赖。其他服务器服务也不应仅因处于 running 状态就列为项目依赖。

默认不对服务器配置进行修改，除非用户明确要求。状态快照会随服务器变化；需要回答实时状态时应重新只读检查，不能把本节快照当成永久保证。

## App Server / Relay 约定

- 本机 `codex app-server` 优先监听 `ws://127.0.0.1:4500`。
- 真机公网访问优先走 Cloudflare Tunnel + relay，不直接暴露 `4500`。
- relay token / capability token 属于敏感配置，移动端必须走 `expo-secure-store`。
- iPhone / Expo Go 对 WebSocket 自定义 `Authorization` header 不稳定时，使用 relay query token，由 relay 注入上游 bearer token。

## 移动端功能约定

- 会话列表按工作区分组；自定义工作区排在 Codex 默认日期目录前面。
- `/Documents/Codex/YYYY-MM-DD/...` 目录显示为 `Codex / YYYY-MM-DD`。
- 消息流要避免频繁整体重渲染；delta 合并、自动滚动、长文本折叠都要保留。
- 只有用户接近底部时才自动滚到底部。
- 图片、diff、命令输出等大内容不要直接塞满主列表，使用预览或 bottom sheet。
- 审批和 `tool/requestUserInput` 优先嵌入对应 timeline item；无法匹配时再顶部兜底。

## 验证要求

提交或声明完成前运行：

```bash
pnpm typecheck
```

如果改动涉及脚本，也要手动运行对应脚本的最小验证命令。无法真机验证时，要明确说明只完成了类型检查。

## Git 约定

- 提交信息使用 Conventional Commits，例如 `feat(mobile): ...`、`fix(relay): ...`。
- 提交前检查 `git status --short` 和暂存范围。
- 不要把用户未要求的无关改动混进提交。
