#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";

const DEFAULT_INTERVAL_MS = 3000;
const DEFAULT_MAX_RECENT_THREADS = 3;
const DEFAULT_NOTIFICATION_DEBOUNCE_MS = 250;
const DETAIL_TURN_PAGE_SIZE = 4;

const REFRESH_NOTIFICATION_METHODS = new Set([
  "thread/started",
  "thread/status/changed",
  "thread/name/updated",
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "rawResponseItem/completed",
  "item/agentMessage/delta",
  "item/plan/delta",
  "command/exec/outputDelta",
  "process/outputDelta",
  "process/exited",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "serverRequest/resolved",
]);

export function parseBridgeConfig(env = process.env) {
  return {
    url: new URL(env.CODEX_APP_SERVER_URL || "ws://127.0.0.1:4500"),
    tokenFile: env.CODEX_APP_SERVER_TOKEN_FILE || "",
    token: env.CODEX_APP_SERVER_TOKEN || "",
    threadId: normalizeOptionalString(env.DESKTOP_REFRESH_BRIDGE_THREAD_ID),
    cwd: normalizeOptionalString(env.DESKTOP_REFRESH_BRIDGE_CWD),
    once: env.DESKTOP_REFRESH_BRIDGE_ONCE === "1",
    intervalMs: parsePositiveInteger(env.DESKTOP_REFRESH_BRIDGE_INTERVAL_MS, DEFAULT_INTERVAL_MS),
    notificationDebounceMs: parsePositiveInteger(env.DESKTOP_REFRESH_BRIDGE_NOTIFICATION_DEBOUNCE_MS, DEFAULT_NOTIFICATION_DEBOUNCE_MS),
    maxRecentThreads: parsePositiveInteger(env.DESKTOP_REFRESH_BRIDGE_MAX_RECENT, DEFAULT_MAX_RECENT_THREADS),
  };
}

export function selectTargetThreadIds({ explicitThreadId, loadedThreadIds, recentThreads, cwd, maxRecentThreads }) {
  if (explicitThreadId) {
    return [explicitThreadId];
  }

  const selected = [];
  const seen = new Set();
  for (const threadId of loadedThreadIds ?? []) {
    addThreadId(selected, seen, threadId);
  }

  const matchingRecentThreads = (recentThreads ?? []).filter((thread) => !cwd || thread.cwd === cwd).slice(0, maxRecentThreads);
  for (const thread of matchingRecentThreads) {
    addThreadId(selected, seen, thread.id);
  }

  return selected;
}

export function buildThreadRefreshRequests(threadId) {
  return [
    {
      method: "thread/resume",
      params: {
        threadId,
        excludeTurns: true,
        initialTurnsPage: {
          limit: DETAIL_TURN_PAGE_SIZE,
          sortDirection: "desc",
          itemsView: "full",
        },
        persistExtendedHistory: false,
      },
    },
    {
      method: "thread/read",
      params: {
        threadId,
        includeTurns: true,
      },
    },
    {
      method: "thread/turns/list",
      params: {
        threadId,
        cursor: null,
        limit: DETAIL_TURN_PAGE_SIZE,
        sortDirection: "desc",
        itemsView: "full",
      },
    },
  ];
}

export function extractRefreshThreadId(message) {
  if (!message || typeof message !== "object" || "id" in message || !REFRESH_NOTIFICATION_METHODS.has(message.method)) {
    return null;
  }

  const params = message.params;
  if (!params || typeof params !== "object") {
    return null;
  }

  if (typeof params.threadId === "string" && params.threadId.trim()) {
    return params.threadId;
  }

  if (params.thread && typeof params.thread === "object" && typeof params.thread.id === "string" && params.thread.id.trim()) {
    return params.thread.id;
  }

  return null;
}

export function createNotificationRefreshScheduler({
  debounceMs,
  refreshThread,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  const pendingTimers = new Map();

  return {
    handleNotification(message) {
      const threadId = extractRefreshThreadId(message);
      if (!threadId) {
        return;
      }

      if (pendingTimers.has(threadId)) {
        clearTimeoutFn(pendingTimers.get(threadId));
      }

      // 手机端一次发送会触发多种 turn/item 通知；按 thread 合并，避免短时间内重复 read/list。
      const timer = setTimeoutFn(async () => {
        pendingTimers.delete(threadId);
        await refreshThread(threadId);
      }, debounceMs);
      pendingTimers.set(threadId, timer);
    },
    stop() {
      for (const timer of pendingTimers.values()) {
        clearTimeoutFn(timer);
      }
      pendingTimers.clear();
    },
  };
}

async function runBridge(config) {
  const token = readToken(config);
  let stopped = false;
  let scheduler = null;
  const client = await connectJsonRpc(config.url, token, {
    onNotification(message) {
      scheduler?.handleNotification(message);
    },
  });

  scheduler = createNotificationRefreshScheduler({
    debounceMs: config.notificationDebounceMs,
    refreshThread: async (threadId) => {
      try {
        await refreshThread(client, threadId);
        logStatus("notification-refresh", `已根据通知刷新 thread: ${threadId}`);
      } catch (error) {
        logStatus("warn", `notification refresh ${threadId}: ${formatError(error)}`);
      }
    },
  });

  const stop = () => {
    stopped = true;
    scheduler?.stop();
    client.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await initializeClient(client);

    do {
      await refreshOnce(client, config);
      if (config.once) {
        break;
      }
      await sleep(config.intervalMs);
    } while (!stopped);
  } finally {
    stop();
  }
}

async function initializeClient(client) {
  await client.request("initialize", {
    clientInfo: {
      name: "desktop-refresh-bridge",
      title: "Desktop Refresh Bridge",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
    },
  });

  client.notify("initialized", {});
}

async function refreshOnce(client, config) {
  const [loaded, recent] = await Promise.all([
    requestOrFallback(client, "thread/loaded/list", { limit: 50 }, { data: [] }),
    requestOrFallback(client, "thread/list", {
      limit: Math.max(config.maxRecentThreads, 1),
      sortKey: "updated_at",
      sortDirection: "desc",
      archived: false,
      cwd: config.cwd || undefined,
    }, { data: [] }),
  ]);

  const targets = selectTargetThreadIds({
    explicitThreadId: config.threadId,
    loadedThreadIds: loaded.data ?? [],
    recentThreads: recent.data ?? [],
    cwd: config.cwd,
    maxRecentThreads: config.maxRecentThreads,
  });

  if (targets.length === 0) {
    logStatus("idle", "没有找到可刷新的 thread");
    return;
  }

  for (const threadId of targets) {
    await refreshThread(client, threadId);
  }

  logStatus("refreshed", `已刷新 ${targets.length} 个 thread: ${targets.join(", ")}`);
}

async function refreshThread(client, threadId) {
  // 桌面左侧列表已知道更新时间，但详情可能复用旧 turns；这里主动 resume/read/list，尽量把同一 thread 的最新明细热加载到 app-server。
  for (const request of buildThreadRefreshRequests(threadId)) {
    try {
      await client.request(request.method, request.params);
    } catch (error) {
      if (request.method !== "thread/resume") {
        throw error;
      }
      // loaded thread 调用 resume 可能被服务端认为不需要恢复；继续 read/list，不让一次兼容性差异中断刷新。
      logStatus("resume-skip", `${threadId}: ${formatError(error)}`);
    }
  }
}

async function requestOrFallback(client, method, params, fallback) {
  try {
    return await client.request(method, params);
  } catch (error) {
    logStatus("warn", `${method}: ${formatError(error)}`);
    return fallback;
  }
}

async function connectJsonRpc(url, token, options = {}) {
  const upgrade = await requestUpgrade(url, token);
  if (upgrade.status !== 101) {
    throw new Error(`WebSocket upgrade failed: ${upgrade.status} ${upgrade.body || ""}`.trim());
  }

  return createJsonRpcSocketClient(upgrade.socket, options);
}

function requestUpgrade(targetUrl, token) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString("base64");
    const transport = targetUrl.protocol === "wss:" ? https : http;
    const headers = {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": key,
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const req = transport.request(
      {
        host: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === "wss:" ? 443 : 80),
        path: `${targetUrl.pathname || "/"}${targetUrl.search || ""}`,
        headers,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
          });
        });
      },
    );

    req.on("upgrade", (res, socket) => {
      resolve({
        status: 101,
        headers: res.headers,
        body: "",
        socket,
      });
    });

    req.on("error", (error) => {
      resolve({
        status: 0,
        headers: {},
        body: error.message,
      });
    });

    req.end();
  });
}

function createJsonRpcSocketClient(socket, options = {}) {
  let nextId = 1;
  const pending = new Map();
  const reader = createFrameReader(socket, (message) => {
    if (!("id" in message)) {
      options.onNotification?.(message);
      return;
    }

    if (!pending.has(message.id)) {
      return;
    }

    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if ("error" in message) {
      reject(new Error(message.error?.message ?? JSON.stringify(message.error)));
      return;
    }

    resolve(message.result);
  });

  socket.on("error", (error) => {
    rejectAllPending(pending, error);
  });
  socket.on("close", () => {
    rejectAllPending(pending, new Error("websocket closed"));
  });

  return {
    request(method, params) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        sendFrame(
          socket,
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            method,
            params,
          }),
        );
      });
    },
    notify(method, params) {
      sendFrame(
        socket,
        JSON.stringify({
          jsonrpc: "2.0",
          method,
          params,
        }),
      );
    },
    close() {
      reader.stop();
      socket.destroy();
    },
  };
}

function createFrameReader(socket, onMessage) {
  let buffer = Buffer.alloc(0);
  let stopped = false;

  socket.on("data", (chunk) => {
    if (stopped) {
      return;
    }

    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      const opcode = first & 0x0f;
      let offset = 2;
      let length = second & 0x7f;
      const masked = (second & 0x80) !== 0;

      if (length === 126) {
        if (buffer.length < offset + 2) {
          return;
        }
        length = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        throw new Error("64-bit frames are not supported");
      }

      const maskLength = masked ? 4 : 0;
      if (buffer.length < offset + maskLength + length) {
        return;
      }

      let payload = buffer.subarray(offset + maskLength, offset + maskLength + length);
      if (masked) {
        const mask = buffer.subarray(offset, offset + 4);
        const unmasked = Buffer.alloc(length);
        for (let i = 0; i < length; i += 1) {
          unmasked[i] = payload[i] ^ mask[i % 4];
        }
        payload = unmasked;
      }

      buffer = buffer.subarray(offset + maskLength + length);

      if (opcode === 0x1) {
        onMessage(JSON.parse(payload.toString("utf8")));
      } else if (opcode === 0x8) {
        stopped = true;
        socket.destroy();
        return;
      }
    }
  });

  return {
    stop() {
      stopped = true;
    },
  };
}

function sendFrame(socket, payloadText) {
  const payload = Buffer.from(payloadText, "utf8");
  const mask = crypto.randomBytes(4);
  const header = [];
  header.push(0x81);
  if (payload.length < 126) {
    header.push(0x80 | payload.length);
  } else if (payload.length < 65536) {
    header.push(0x80 | 126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    throw new Error("payload too large");
  }

  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    masked[i] = payload[i] ^ mask[i % 4];
  }
  socket.write(Buffer.concat([Buffer.from(header), mask, masked]));
}

function rejectAllPending(pending, error) {
  for (const { reject } of pending.values()) {
    reject(error);
  }
  pending.clear();
}

function readToken(config) {
  if (config.tokenFile) {
    return fs.readFileSync(config.tokenFile, "utf8").trim();
  }
  return config.token.trim();
}

function addThreadId(selected, seen, threadId) {
  if (!threadId || seen.has(threadId)) {
    return;
  }

  seen.add(threadId);
  selected.push(threadId);
}

function normalizeOptionalString(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logStatus(kind, message) {
  console.log(`[desktop-refresh-bridge] ${new Date().toISOString()} ${kind}: ${message}`);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBridge(parseBridgeConfig()).catch((error) => {
    console.error(`[desktop-refresh-bridge] fatal: ${formatError(error)}`);
    process.exit(1);
  });
}
