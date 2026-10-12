import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 将确认后的图形整理为精确几何；PNG 和 SVG 共用比例，避免不同平台图标变形。
const require = createRequire(import.meta.url);
const Jimp = require("jimp-compact"); // 复用 Expo 已安装的构建工具，不增加生产依赖。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = resolve(root, "apps/mobile/assets");
const previewDir = resolve(root, "dist/icon-preview");
const foregroundScale = 0.88;
const ring = { x: 548, y: 512, radius: 248, width: 110 };
const angle = Math.PI / 4;
const tip = ring.radius * Math.cos(angle);
const prompt = [[464, 455, 525, 512], [525, 512, 464, 569], [579, 569, 638, 569]];
const mint = [[166, 255, 226], [61, 228, 203], [32, 201, 191]];
const ivory = [245, 253, 250];
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mix = (a, b, t) => a.map((value, i) => Math.round(value + (b[i] - value) * t));

function segmentDistance(x, y, [ax, ay, bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy) - 20;
}

function ringDistance(x, y) {
  const dx = x - ring.x;
  const dy = y - ring.y;
  // 右侧开口为 90°，端点用圆帽，与 SVG 的 round linecap 完全一致。
  const distance = Math.abs(Math.atan2(dy, dx)) >= angle
    ? Math.abs(Math.hypot(dx, dy) - ring.radius)
    : Math.min(Math.hypot(dx - tip, dy - tip), Math.hypot(dx - tip, dy + tip));
  return distance - ring.width / 2;
}

function paint(size, { background = false, monochrome = false, scale = 1 } = {}) {
  const image = new Jimp(size, size, 0x00000000);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const u = (px + 0.5) * 1024 / size;
      const v = (py + 0.5) * 1024 / size;
      const x = (u - 512) / scale + 512;
      const y = (v - 512) / scale + 512;
      const c = ringDistance(x, y);
      const p = Math.min(...prompt.map((line) => segmentDistance(x, y, line)));
      const coverage = clamp(0.5 - Math.min(c, p) * scale * size / 1024);
      const t = clamp(((x - 256) * 504 + (y - 208) * 608) / (504 ** 2 + 608 ** 2));
      let color = monochrome ? [255, 255, 255]
        : p < c ? ivory : t < 0.5 ? mix(mint[0], mint[1], t * 2) : mix(mint[1], mint[2], t * 2 - 1);
      if (background) {
        const base = mix([27, 48, 59], [10, 18, 27], clamp((u + v) / 2048));
        color = mix(base, color, coverage);
      }
      const offset = (py * size + px) * 4;
      const alpha = background ? 255 : Math.round(coverage * 255);
      image.bitmap.data.set(alpha ? [...color, alpha] : [0, 0, 0, 0], offset);
    }
  }
  return image;
}

function svg({ background = false, monochrome = false, scale = 1 } = {}) {
  const startX = (ring.x + tip).toFixed(6);
  const topY = (ring.y - tip).toFixed(6);
  const bottomY = (ring.y + tip).toFixed(6);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="mint" gradientUnits="userSpaceOnUse" x1="256" y1="208" x2="760" y2="816"><stop stop-color="#a6ffe2"/><stop offset=".5" stop-color="#3de4cb"/><stop offset="1" stop-color="#20c9bf"/></linearGradient>
    <linearGradient id="night" x2="1" y2="1"><stop stop-color="#1b303b"/><stop offset="1" stop-color="#0a121b"/></linearGradient>
  </defs>
  ${background ? '<path fill="url(#night)" d="M0 0h1024v1024H0z"/>' : ""}
  <g transform="translate(512 512) scale(${scale}) translate(-512 -512)" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${startX} ${topY} A248 248 0 1 0 ${startX} ${bottomY}" stroke="${monochrome ? "white" : "url(#mint)"}" stroke-width="110"/>
    <path d="M464 455 525 512 464 569 M579 569h59" stroke="${monochrome ? "white" : "#f5fdfa"}" stroke-width="40"/>
  </g>
</svg>
`;
}

await mkdir(assets, { recursive: true });
await mkdir(previewDir, { recursive: true });
const variants = [
  ["icon", { background: true }],
  ["android-icon-foreground", { scale: foregroundScale }],
  ["android-icon-monochrome", { scale: foregroundScale, monochrome: true }],
  ["splash-icon", { scale: foregroundScale }],
];
for (const [name, options] of variants) {
  await paint(1024, options).writeAsync(resolve(assets, `${name}.png`));
  await writeFile(resolve(assets, `${name}.svg`), svg(options), "utf8");
}
const background = new Jimp(1024, 1024, 0);
for (let y = 0; y < 1024; y += 1) {
  for (let x = 0; x < 1024; x += 1) {
    const color = mix([27, 48, 59], [10, 18, 27], (x + y + 1) / 2048);
    background.bitmap.data.set([...color, 255], (y * 1024 + x) * 4);
  }
}
await background.writeAsync(resolve(assets, "android-icon-background.png"));
await paint(64, { background: true }).writeAsync(resolve(assets, "favicon.png"));

// 保存桌面裁切及小尺寸预览，便于目视检查；预览不进入版本控制。
const sheet = new Jimp(1040, 420, 0xf2f5f9ff);
const positions = [24, 284, 544, 804];
for (const [index, kind] of ["rounded", "circle", "squircle", "themed"].entries()) {
  // Android 默认可视区约为图层的 72/108；预览真实裁切后的标志大小。
  const scale = kind === "rounded" ? 1 : foregroundScale * 108 / 72;
  const icon = paint(212, { background: true, monochrome: kind === "themed", scale });
  for (let y = 0; y < 212; y += 1) {
    for (let x = 0; x < 212; x += 1) {
      const dx = Math.abs((x + 0.5 - 106) / 106);
      const dy = Math.abs((y + 0.5 - 106) / 106);
      const inside = kind === "circle" ? dx ** 2 + dy ** 2 <= 1
        : kind === "squircle" ? dx ** 4 + dy ** 4 <= 1
        : Math.hypot(Math.max(dx - 0.6, 0), Math.max(dy - 0.6, 0)) <= 0.4;
      if (!inside) icon.bitmap.data[(y * 212 + x) * 4 + 3] = 0;
    }
  }
  sheet.composite(icon, positions[index], 32);
  for (const [size, offset] of [[64, 0], [48, 90], [32, 160]]) {
    sheet.composite(paint(size, { background: true, monochrome: kind === "themed", scale }), positions[index] + offset, 300);
  }
}
await sheet.writeAsync(resolve(previewDir, "launcher-preview.png"));
await paint(320, { background: true }).writeAsync(resolve(previewDir, "icon.png"));
console.log("已生成主图标、Android 分层/单色图标、启动图和 favicon；预览：dist/icon-preview/launcher-preview.png");
