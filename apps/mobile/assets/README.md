# App 图标

图标使用薄荷绿 C 环和终端提示符，搭配深色渐变背景。保留 SVG 几何稿，避免生成图形的毛边进入正式图标。

从仓库根目录运行 `node scripts/generate-app-icons.mjs`，重新导出以下素材：

- `icon.png`：1024 × 1024，不透明主图标，交给系统裁切外形。
- `android-icon-foreground.png`：1024 × 1024，透明前景，标志位于中心安全区域。
- `android-icon-background.png`：1024 × 1024，不透明渐变背景。
- `android-icon-monochrome.png`：与前景相同比例的白色透明轮廓，供 Android 主题图标使用。
- `splash-icon.png`：透明背景的同款标志，保留为启动页素材；当前配置未引用它。
- `favicon.png`：64 × 64，小尺寸浏览器图标。

生成脚本复用 Expo 安装的 `jimp-compact`，不增加依赖。各 SVG 与 PNG 从同一组几何参数生成；调整比例时应修改生成脚本后重新运行。

圆形、圆角、超椭圆及单色外观预览保存在被 Git 忽略的 `dist/icon-preview/launcher-preview.png`。更新素材后，已安装的 APK 需要重新打包安装才能更换桌面图标。
