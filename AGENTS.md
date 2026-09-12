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

Windows 下直接在本仓库编译会触发 CMake 长路径错误。先把最新源码复制到 `C:\a`，排除 `.git`、`node_modules` 和旧的 `apps\mobile\android`，再执行：

```powershell
$BuildRoot = 'C:\Users\liuzhuo\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\CodexAndroidBuild'
$env:JAVA_HOME = "$BuildRoot\jdk\jdk-17.0.20.1+1"
$env:ANDROID_HOME = "$BuildRoot\android-sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:NODE_ENV = 'production'

cd C:\a
pnpm install --frozen-lockfile --node-linker=hoisted
cd apps\mobile
C:\a\node_modules\.bin\expo.cmd prebuild --clean --platform android --no-install
cd android
.\gradlew.bat assembleRelease --no-daemon
```

产物位于 `C:\a\apps\mobile\android\app\build\outputs\apk\release\app-release.apk`。

### 在受限沙箱里构建（workbuddy实测可用）

上面那段 PowerShell 流程在部分 agent 运行环境里**跑不通**：Bash 的 PATH 缺 `/usr/bin`（`ls`/`tr` 都找不到），
从 Bash 调 `cmd.exe` 会被沙箱拦截（所以 `gradlew.bat` 不可用），PowerShell 工具也可能不回传 stdout。
实测可用的等价路径是全程走 Bash + Gradle 自带的 POSIX wrapper：

```bash
export PATH="/usr/bin:/bin:/c/Windows/System32:$PATH"
export MSYS2_ARG_CONV_EXCL='*'   # 否则 robocopy 的 /E /XD 会被 MSYS 当路径转换

# 1. 同步源码到 C:\a（排除 android，让 prebuild 重新生成）
Robocopy.exe "C:\file\app-codexapp" "C:\a" /E \
  /XD .git node_modules dist build-logs android .pnpm-store .deep-copilot .workbuddy /NFL /NDL /NP

# 2. 安装依赖
cd /c/a && pnpm install --frozen-lockfile --node-linker=hoisted

# 3. 生成原生工程
cd /c/a/apps/mobile && NODE_ENV=production /c/a/node_modules/.bin/expo.CMD prebuild --platform android --no-install

# 4. 手写 android/local.properties（prebuild 不会生成）
#    sdk.dir=C\:\\Users\\liuzhuo\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\CodexAndroidBuild\\android-sdk

# 5. 编译（JAVA_HOME 必须是 POSIX 风格路径）
JDK="/c/Users/liuzhuo/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/CodexAndroidBuild/jdk/jdk-17.0.20.1+1"
export JAVA_HOME="$JDK"
export ANDROID_HOME="C:\\Users\\liuzhuo\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\CodexAndroidBuild\\android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export NODE_ENV=production
export PATH="$JDK/bin:$PATH"
cd /c/a/apps/mobile/android && bash ./gradlew assembleRelease --no-daemon
```

坑位速查：

| 现象 | 处理 |
|---|---|
| `ls: command not found` | `export PATH="/usr/bin:/bin:/c/Windows/System32:$PATH"` |
| `Invoking cmd.exe from Bash ... blocked` | 别用 `.bat`/`.cmd`，改用 POSIX wrapper `bash ./gradlew` |
| `gradlew` 找不到 java | `JAVA_HOME` 用 `/c/Users/...`，Windows 反斜杠风格不生效 |
| robocopy 报参数错误 | `export MSYS2_ARG_CONV_EXCL='*'` |
| prebuild 长时间无输出 | 见下 |

**`expo prebuild --clean` 会偶发卡死**：停滞十分钟零文件写入，`C:\a\apps\mobile\android` 处于半清理状态
（残留上一次构建的 `.gradle`/`.kotlin`/`local.properties`，却缺少刚生成的 `gradle/wrapper/`）——
`--clean` 的删除步骤被沙箱部分拦截。处置：停掉任务 → `rm -rf` 清空该目录 → **不带 `--clean`** 重跑
（目录本已为空，两者等价），几秒即完成。

排查卡死不要只看进程状态，直接看目录时间戳：
`find /c/a/apps/mobile/android -maxdepth 2 -printf "%T+ %p\n" | sort -r | head`。
另外 `| tail -N` 会缓冲到进程结束才输出，排查时改用 `| tee <log>` 边跑边看。

### 产物校验与归档

- 归档到 `dist/`，命名 `codex-mobile-<特性>-<YYYYMMDD>.apk`，同一天的第二版加 `-r2` 之类后缀。`dist/` 已被 `.gitignore` 忽略。
- 签名：release buildType 继承 `signingConfigs.debug`，是 **v2 签名**。判断 v2 要解析 APK Signing Block
  （magic 位于 ZIP 中央目录前 16 字节），只看 `META-INF/*.RSA` 会把已签名的包误判成未签名。
- 声明「改动已生效」前，解出 `assets/index.android.bundle` 并搜索本次新增的**对象字面量属性名**
  （调用点里显式写出的 key）。Metro 压缩默认不改属性名，所以这类标识搜得到；局部变量名可能被改名，
  不要拿它当依据。这比只看「构建成功」可靠得多。

## 当前链路配置（2026-09-11）

本机：

- App Server 监听 `127.0.0.1:4500`，Relay 监听 `127.0.0.1:4501`。
- SSH 反向隧道连接 `root@8.148.73.94`，把服务器 `127.0.0.1:4501` 转到本机 Relay。
- token 保存在 `%USERPROFILE%\.codex\app-server\`，禁止写入仓库或文档。
- `start-phone-tunnel.bat` 隐藏启动，并每 60 秒检查链路；连续失败 2 次后自动修复。
- `restart-phone-tunnel.bat` 仅重启 App Server，用于处理 `active writer` 等状态残留。
- `stop-phone-tunnel.bat` 停止本机监控器、App Server、Relay 和反向隧道，不停止服务器进程。

远程服务器：

- 当前运行 1 个 Quick Tunnel：`cloudflared tunnel --url http://127.0.0.1:4501`。
- `127.0.0.1:4501/readyz` 状态为 `ok`。
- 当前公网地址为 `https://front-imagine-patents-differential.trycloudflare.com`；Quick Tunnel 进程重建后地址可能变化。
- 默认不对服务器配置进行任何修改，除非用户明确要求。

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
