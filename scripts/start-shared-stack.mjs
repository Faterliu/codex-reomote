#!/usr/bin/env node

// 共用 App Server 启动脚本。
//
// 目标：让「电脑端 CLI」和「手机端」同时作为客户端，连接到同一个 codex app-server，
// 从而避免两个独立 App Server 进程竞争同一 thread 的写入权（already has an active writer）。
//
// 与 start-lan-stack.mjs / start-cloudflare-stack.mjs 的关键区别：
//   - 若 127.0.0.1:4500 已有一个健康的 app-server，则直接复用，不再断言端口空闲。
//   - 额外打印电脑端接入命令（codex --remote ...），电脑端不要再用 Codex Desktop App。
//
// 模式自动判断：
//   - 设置 PUBLIC_CODEX_MOBILE_URL -> Cloudflare 模式（relay 只监听 127.0.0.1，并启动 cloudflared）。
//   - 否则 -> 局域网模式（relay 监听 0.0.0.0，手机连局域网 IP）。

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import qrcode from "qrcode-terminal";

const appServerPort = Number(process.env.CODEX_APP_SERVER_PORT || "4500");
const mobileTokenFile = process.env.CODEX_APP_SERVER_TOKEN_FILE || homePath(".codex", "app-server", "mobile.token");
const relayTokenFile = process.env.RELAY_TOKEN_FILE || homePath(".codex", "app-server", "relay.token");
const relayListenPort = Number(process.env.RELAY_LISTEN_PORT || "4501");

const cloudflareMode = Boolean(process.env.PUBLIC_CODEX_MOBILE_URL);
const cloudflaredConfig = process.env.CLOUDFLARED_CONFIG || homePath(".cloudflared", "codex-mobile.yml");
const publicMobileUrl = cloudflareMode ? normalizePublicUrl(process.env.PUBLIC_CODEX_MOBILE_URL) : "";
const relayListenHost = cloudflareMode ? "127.0.0.1" : "0.0.0.0";
const lanHost = process.env.CODEX_MOBILE_LAN_HOST || getLanIpAddress();
const mobileUrl = cloudflareMode ? publicMobileUrl : `ws://${lanHost}:${relayListenPort}`;

const children = [];

await ensureTokenFile(mobileTokenFile, "Codex app-server token");
await ensureTokenFile(relayTokenFile, "relay token");

if (cloudflareMode) {
  await assertFile(cloudflaredConfig, "cloudflared config");
}

const relayToken = fs.readFileSync(relayTokenFile, "utf8").trim();
const mobileConnectionPayload = JSON.stringify({
  kind: "codex-mobile-connection",
  version: 1,
  url: mobileUrl,
  token: relayToken,
});

// 1) 复用或启动唯一的 app-server。
const appServerHealthy = await checkReadyz("127.0.0.1", appServerPort);
if (appServerHealthy) {
  console.log(`[app-server] reusing existing app-server at ws://127.0.0.1:${appServerPort}`);
} else if (await isPortListening("127.0.0.1", appServerPort)) {
  throw new Error(
    `port 127.0.0.1:${appServerPort} is occupied but does not respond to /readyz. ` +
      "Stop the conflicting process (e.g. a previously started app-server) and retry.",
  );
} else {
  // Windows 上 `codex` 是 npm 的 codex.cmd 垫片，spawn 需要 shell 才能解析；macOS/Linux 是真实二进制。
  start(
    "codex-app-server",
    "codex",
    [
      "app-server",
      "--listen",
      `ws://127.0.0.1:${appServerPort}`,
      "--ws-auth",
      "capability-token",
      "--ws-token-file",
      mobileTokenFile,
    ],
    {},
    { shell: process.platform === "win32" },
  );
  await waitForHealthy("127.0.0.1", appServerPort, "codex app-server");
}

// 2) 复用或启动 relay。
const relayHealthy = await checkReadyz(relayListenHost === "0.0.0.0" ? "127.0.0.1" : relayListenHost, relayListenPort);
if (relayHealthy) {
  console.log(`[relay] reusing existing relay at ws://${relayListenHost}:${relayListenPort}`);
} else if (await isPortListening(relayListenHost === "0.0.0.0" ? "127.0.0.1" : relayListenHost, relayListenPort)) {
  throw new Error(
    `port ${relayListenHost}:${relayListenPort} is occupied but does not respond to /readyz. Resolve that conflict before continuing.`,
  );
} else {
  start(
    "relay",
    "node",
    ["scripts/app-server-relay.mjs"],
    {
      RELAY_LISTEN_HOST: relayListenHost,
      RELAY_LISTEN_PORT: String(relayListenPort),
      RELAY_TOKEN: relayToken,
      UPSTREAM_WS_URL: `ws://127.0.0.1:${appServerPort}`,
      UPSTREAM_TOKEN_FILE: mobileTokenFile,
    },
  );
  await waitForHealthy(relayListenHost === "0.0.0.0" ? "127.0.0.1" : relayListenHost, relayListenPort, "relay");
}

// 3) Cloudflare 模式下启动 tunnel。
if (cloudflareMode) {
  start("cloudflared", "cloudflared", ["tunnel", "--config", cloudflaredConfig, "run"]);
}

printUsage();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
});

function printUsage() {
  const modeLabel = cloudflareMode ? "Cloudflare" : "LAN";
  console.log(`\nShared App Server stack is ready (mode: ${modeLabel}).`);
  console.log(`app-server: ws://127.0.0.1:${appServerPort}`);
  console.log(`relay:      ws://${relayListenHost}:${relayListenPort}`);

  console.log("\nDesktop CLI — run in a separate terminal (do NOT open the Desktop App):");
  console.log("  PowerShell:");
  console.log(`    $env:CODEX_REMOTE_TOKEN = (Get-Content "${mobileTokenFile}" -Raw).Trim()`);
  console.log(`    codex --remote ws://127.0.0.1:${appServerPort} --remote-auth-token-env CODEX_REMOTE_TOKEN`);
  console.log("  bash / zsh:");
  console.log(`    export CODEX_REMOTE_TOKEN="$(cat "${mobileTokenFile}")"`);
  console.log(`    codex --remote ws://127.0.0.1:${appServerPort} --remote-auth-token-env CODEX_REMOTE_TOKEN`);

  console.log("\nMobile:");
  console.log(`${mobileUrl}?relay_token=${relayToken}`);
  console.log("\nScan this QR in the mobile app connection settings:");
  qrcode.generate(mobileConnectionPayload, { small: true });

  if (!cloudflareMode) {
    console.log("\nKeep your phone and this computer on the same network. Press Ctrl+C to stop.\n");
  } else {
    console.log("\nPublic traffic reaches only the relay; do not expose the bare app-server. Press Ctrl+C to stop.\n");
  }
}

function start(name, command, args, extraEnv = {}, options = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
    ...(options.shell ? { shell: true } : {}),
  });

  children.push(child);

  child.stdout.on("data", (chunk) => {
    writePrefixed(name, chunk);
  });

  child.stderr.on("data", (chunk) => {
    writePrefixed(name, chunk);
  });

  child.on("exit", (code, signal) => {
    if (code === 0 || signal) {
      return;
    }

    console.error(`[${name}] exited with code ${code}`);
    shutdown();
  });
}

function writePrefixed(name, chunk) {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (line) {
      console.log(`[${name}] ${line}`);
    }
  }
}

function homePath(...segments) {
  return path.join(os.homedir(), ...segments);
}

async function ensureTokenFile(filePath, label) {
  if (fs.existsSync(filePath)) {
    return;
  }

  // 首次运行自动生成本地 token，避免还没配置就启动失败。
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${crypto.randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
  console.log(`${label} created: ${filePath}`);
}

async function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function normalizePublicUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function getLanIpAddress() {
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }

  throw new Error("No LAN IPv4 address found. Set CODEX_MOBILE_LAN_HOST manually.");
}

function checkReadyz(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const request = http.get({ host, port, path: "/readyz", timeout: timeoutMs }, (response) => {
      // app-server 的 /readyz 返回 200 + 空 body；relay 返回 200 + "ok"。这里只以 200 为准。
      response.resume();
      resolve(response.statusCode === 200);
    });

    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

async function waitForHealthy(host, port, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await checkReadyz(host, port)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`${label} did not become ready on ${host}:${port} within ${timeoutMs}ms.`);
}

function isPortListening(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(750);

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  process.exit(0);
}
