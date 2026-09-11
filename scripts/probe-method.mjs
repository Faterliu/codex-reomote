#!/usr/bin/env node
// 通用只读方法探针：连上本地 codex app-server，调用单个 JSON-RPC 方法并打印结果。
// 用法：node scripts/probe-method.mjs account/rateLimits/read
// 可选：CODEX_APP_SERVER_URL / CODEX_APP_SERVER_TOKEN_FILE，默认取本机 4500 与 mobile.token。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";

const method = process.argv[2];
const paramsArg = process.argv[3];

if (!method) {
  console.error("usage: node scripts/probe-method.mjs <method> [json-params]");
  process.exit(2);
}

let params;

if (paramsArg) {
  try {
    params = JSON.parse(paramsArg);
  } catch (error) {
    console.error(`invalid json params: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

const url = new URL(process.env.CODEX_APP_SERVER_URL || "ws://127.0.0.1:4500");
const defaultTokenFile = path.join(os.homedir(), ".codex", "app-server", "mobile.token");
const tokenFile = process.env.CODEX_APP_SERVER_TOKEN_FILE || (fs.existsSync(defaultTokenFile) ? defaultTokenFile : "");
const token = tokenFile ? fs.readFileSync(tokenFile, "utf8").trim() : "";

const headers = token ? { Authorization: `Bearer ${token}` } : {};
const upgrade = await requestUpgrade(url, headers);

if (upgrade.status !== 101) {
  console.log(JSON.stringify({ ok: false, url: url.toString(), status: upgrade.status, headers: upgrade.headers, body: upgrade.body }, null, 2));
  process.exit(1);
}

const result = await requestJsonRpcOverSocket(url, upgrade.socket);
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

function requestUpgrade(targetUrl, extraHeaders) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString("base64");
    const transport = targetUrl.protocol === "wss:" ? https : http;
    const req = transport.request(
      {
        host: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === "wss:" ? 443 : 80),
        path: `${targetUrl.pathname || "/"}${targetUrl.search || ""}`,
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": key,
          ...extraHeaders,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );

    req.on("upgrade", (res, socket) => resolve({ status: 101, headers: res.headers, body: "", socket }));
    req.on("error", (error) => resolve({ status: 0, headers: {}, body: error.message }));
    req.end();
  });
}

async function requestJsonRpcOverSocket(targetUrl, socket) {
  let nextId = 1;
  const pending = new Map();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, url: targetUrl.toString(), method, error: "timeout waiting for JSON-RPC response" });
      socket.destroy();
    }, 15000);

    const reader = createFrameReader(socket, (message) => {
      if ("id" in message && pending.has(message.id)) {
        const { resolve: resolvePending, reject } = pending.get(message.id);
        pending.delete(message.id);

        if ("error" in message) {
          reject(new Error(message.error.message));
          return;
        }

        resolvePending(message.result);
      }
    });

    socket.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, url: targetUrl.toString(), method, error: "websocket socket error" });
    });

    void (async () => {
      try {
        await request("initialize", {
          clientInfo: { name: "probe-method", title: "Probe Method", version: "0.0.1" },
          capabilities: { experimentalApi: true, requestAttestation: false },
        });
        sendFrame(socket, JSON.stringify({ jsonrpc: "2.0", method: "initialized" }));

        const value = await request(method, params);
        clearTimeout(timer);
        reader.stop();
        resolve({ ok: true, url: targetUrl.toString(), method, value });
        socket.destroy();
      } catch (error) {
        clearTimeout(timer);
        reader.stop();
        resolve({ ok: false, url: targetUrl.toString(), method, error: error instanceof Error ? error.message : String(error) });
        socket.destroy();
      }
    })();

    function request(requestMethod, requestParams) {
      const id = nextId++;
      return new Promise((resolvePending, reject) => {
        pending.set(id, { resolve: resolvePending, reject });
        sendFrame(socket, JSON.stringify({ jsonrpc: "2.0", id, method: requestMethod, params: requestParams }));
      });
    }
  });
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
    throw new Error("payload too large for probe");
  }

  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    masked[i] = payload[i] ^ mask[i % 4];
  }

  socket.write(Buffer.concat([Buffer.from(header), mask, masked]));
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
        throw new Error("64-bit frames not supported in probe");
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
