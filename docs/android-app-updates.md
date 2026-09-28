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

## 当前发布

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
