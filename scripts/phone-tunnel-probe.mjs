import fs from "node:fs";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";

// 只做初始化，不恢复对话、不发送消息，也不会取得对话写入锁。
export function probePhoneEndpoint({ url, token, auth = "bearer", timeoutMs = 5000 }) {
  return new Promise((resolve) => {
    let socket;
    let finished = false;
    const finish = (ok, reason) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket?.terminate();
      resolve({ ok, reason });
    };
    const timer = setTimeout(() => finish(false, "timeout"), timeoutMs);
    try {
      const target = new URL(url);
      if (!["ws:", "wss:"].includes(target.protocol) || !["bearer", "query"].includes(auth) || !token?.trim()) {
        finish(false, "configuration");
        return;
      }
      const headers = auth === "bearer" ? { Authorization: `Bearer ${token}` } : {};
      if (auth === "query") target.searchParams.set("relay_token", token);
      socket = new WebSocket(target, { headers, handshakeTimeout: timeoutMs, maxPayload: 1024 * 1024 });
      socket.on("open", () => {
        socket.send(JSON.stringify({ id: "phone-health", method: "initialize", params: {
          clientInfo: { name: "phone-tunnel-health", version: "1.0.0" },
        } }));
      });
      socket.on("message", (data) => {
        try {
          const response = JSON.parse(String(data));
          if (response.id !== "phone-health") return;
          if (response.error || !response.result || typeof response.result !== "object") {
            finish(false, "protocol");
            return;
          }
          socket.send(JSON.stringify({ method: "initialized", params: {} }));
          finish(true, "ready");
        } catch { finish(false, "protocol"); }
      });
      socket.on("unexpected-response", (_request, response) => {
        response.resume();
        finish(false, [401, 403].includes(response.statusCode) ? "authentication" : "unavailable");
      });
      socket.on("error", () => finish(false, "unavailable"));
      socket.on("close", () => finish(false, "unavailable"));
    } catch { finish(false, "configuration"); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // token 只从文件读取；不把 token 放进命令行或错误日志。
  let result;
  try {
    const [url, tokenFile, auth] = process.argv.slice(2);
    const token = fs.readFileSync(tokenFile, "utf8").trim();
    result = await probePhoneEndpoint({ url, token, auth });
  } catch { result = { ok: false, reason: "configuration" }; }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
