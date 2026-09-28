# Android 应用内更新

Android 客户端启动时读取：

https://updates.yinxingye.space/apps/codexapp/latest.json

更新目录遵循服务器现有的 android-recorder 约定：APK 放在 apk/，历史记录放在 versions/<versionCode>.json，latest.json 指向当前版本。

~~~text
/var/www/updates/apps/codexapp/
├── latest.json
├── apk/
│   └── codexapp-update-<date>-v<version>.apk
└── versions/
    └── <versionCode>.json
~~~

发布时先上传 APK 和 versions/<versionCode>.json，最后更新 latest.json。每次发布后保留旧 APK 和版本记录。

## 历史发布示例（1.0.2）

~~~json
{
    "appId":  "codexapp",
    "packageName":  "com.anonymous.mobile",
    "versionCode":  3,
    "versionName":  "1.0.2",
    "apkUrl":  "https://updates.yinxingye.space/apps/codexapp/apk/codexapp-update-20260928-v1.0.2.apk",
    "sha256":  "a443531b67860b3d4264a812c9cc30fac8707495c2d0f80ce8f77dcc06c810a2",
    "fileSize":  45529782,
    "forceUpdate":  false,
    "minSupportedVersionCode":  1,
    "releaseTime":  "2026-09-28T17:50:34+08:00",
    "changelog":  [
                      "主界面新增“检查更新”按钮，用户可以主动检查服务器上的新版本。",
                      "启动时仍会自动检查；下载更新包后校验 SHA-256，再交由 Android 系统安装器安装。"
                  ]
}
~~~

packageName 必须保持为 com.anonymous.mobile。当前版本为 1.0.2、versionCode=3，后续发布时从 versionCode=4 递增。APK 必须使用 HTTPS，并放入 apps/codexapp/apk/；sha256 与 fileSize 必须取自实际 APK。客户端支持 changelog 字符串或字符串数组。

所有发布版本必须使用同一 Android 签名证书，否则 Android 会拒绝覆盖安装。当前发布 APK 已与现有 1.0.0 安装包签名一致。

首次安装更新时，Android 可能要求用户允许 Codex 安装未知来源应用；系统安装器仍可能要求用户确认。服务器对目录索引返回 404 是预期行为，客户端直接请求 latest.json。

## 一键打包和发布（Windows / PowerShell 5.1+）

仓库已固定 `node-linker=hoisted`，脚本直接在当前工作区构建。先准备一个 UTF-8 文本文件，每行一条真实更新说明，例如 `release-notes.txt`。

```powershell
# 只读预检：检查本机工具、线上清单、SSH 和 sudo 权限。
pnpm release:android -CheckOnly

# 完整发布示例：版本号必须大于服务器最新 versionCode。
pnpm release:android -Version 1.0.3 -VersionCode 4 -ChangelogFile .\release-notes.txt

# 可选：强制更新、最低支持版本、构建工具根目录。
pnpm release:android -Version 1.0.4 -VersionCode 5 -ChangelogFile .\release-notes.txt -ForceUpdate -MinSupportedVersionCode 4
```

入口为 `scripts/release-android.ps1`，使用 Windows 自带的 PowerShell 5.1 (`powershell.exe`)，无需安装 `pwsh`；需要 Node、pnpm、OpenSSH，以及现有 JDK/Android SDK。工具不在默认位置时使用 `-BuildRoot`。SSH 使用本机密钥和已信任的主机记录，连接 `admin@8.148.73.94`，不保存密码，也不关闭主机身份校验。服务器需要 `python3` 和免密 `sudo`（当前服务器已具备）。

完整流程：

1. 核对工具、hoisted 配置、服务器版本和权限，使用本地文件锁防止同时发布。
2. 通过 frozen lockfile 安装依赖，运行类型检查，下载并校验当前线上 APK。
3. 更新 `apps/mobile/app.json` 中的版本，执行 Expo prebuild（不使用 `--clean`），保留现有签名文件。
4. 执行 `assembleRelease --no-daemon`；失败立即停止。校验 APK 包名、版本、签名与原生更新模块保留记录。
5. 在 `dist/codexapp-<版本>-<版本号>-<运行ID>/` 归档 APK、清单和日志，计算实际文件大小及 SHA-256。
6. 上传到服务器临时目录，再由 `publish-android-release.py` 加锁并核对线上基准版本，拒绝覆盖历史版本。先发布 APK 和历史 JSON，最后原子替换 `latest.json`。
7. 通过公网重新读取清单并下载 APK 校验 SHA-256，清理远端上传临时文件。

脚本不会自动提交 Git。版本配置修改后会保留在工作区，即使后续步骤失败，也可查看和修复后重新运行；不会自动回退已发布的服务器版本。发布阶段中断可能留下尚未被 latest.json 引用的 APK/版本记录；脚本会拒绝覆盖，需检查服务器状态后处理。若公网验证失败，服务器可能已经发布，先检查线上清单再操作。

`-CheckOnly` 不保证编译通过。2026-09-28 已完整验证原工作区 hoisted 构建，并发布 1.0.3（versionCode 4），公网 APK 哈希校验通过。历史版本号与上文清单只是示例，运行时以服务器返回值为准。

## Windows 入口兼容性修复

遇到 `pwsh 不是内部或外部命令` 时，更新项目脚本后继续使用 `pnpm release:android`；入口已改用系统自带的 `powershell.exe`，不需要另装 PowerShell 7。脚本使用 .NET 计算 SHA-256；更新说明按纯 UTF-8 文本读取，避免 PowerShell 5.1 将文件附加属性序列化进 JSON。安装阶段显式保留开发依赖并禁用交互提示。
