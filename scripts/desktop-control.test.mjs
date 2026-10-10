import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { createProcessControlHandlers } from "./app-server-relay-desktop.mjs";

async function relay(t, options = {}) {
  const calls = [];
  const restartCalls = [];
  const handlers = createProcessControlHandlers({
    relayToken: "test-relay-token", platform: "win32", appServerPort: 4500, relayPort: 4501,
    tokenFile: "local-test.token", stop: async (ports) => { calls.push(ports); },
    restart: async (ports) => { restartCalls.push(ports); }, ...options,
  });
  const server = http.createServer((req, res) => { void (req.url?.startsWith("/app-server/restart") ? handlers.restartAppServer : handlers.stopDesktop)(req, res); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { calls, restartCalls, url: `http://127.0.0.1:${server.address().port}/desktop/stop`, restartUrl: `http://127.0.0.1:${server.address().port}/app-server/restart` };
}

const authorized = { method: "POST", headers: { Authorization: "Bearer test-relay-token" } };

test("HTTP process control rejects unauthorized, GET and query-token requests without execution", async (t) => {
  const { calls, url } = await relay(t);
  assert.equal((await fetch(url, { ...authorized, method: "GET" })).status, 405);
  assert.equal((await fetch(url, { method: "POST" })).status, 403);
  assert.equal((await fetch(`${url}?relay_token=test-relay-token`, { method: "POST" })).status, 403);
  assert.equal((await fetch(url, { method: "POST", headers: { Authorization: "Bearer wrong-token" } })).status, 403);
  assert.equal((await fetch(url, { method: "POST", headers: { Authorization: "test-relay-token" } })).status, 403);
  assert.deepEqual(calls, []);
  const response = await fetch(`${url}?script=untrusted.ps1`, { ...authorized, body: '{"command":"untrusted"}' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.deepEqual(calls, [{ appServerPort: 4500, relayPort: 4501 }]);
});

test("HTTP control requires a configured token and Windows", async (t) => {
  const unconfigured = await relay(t, { relayToken: "" });
  assert.equal((await fetch(unconfigured.url, authorized)).status, 503);
  assert.deepEqual(unconfigured.calls, []);
  const unsupported = await relay(t, { platform: "linux" });
  assert.equal((await fetch(unsupported.url, authorized)).status, 501);
  assert.deepEqual(unsupported.calls, []);
});

test("restart requires POST and bearer authentication and ignores remote script arguments", async (t) => {
  const { restartCalls, restartUrl } = await relay(t);
  for (const options of [
    { ...authorized, method: "GET" }, { method: "POST" },
    { method: "POST", headers: { Authorization: "Bearer wrong-token" } },
  ]) assert.notEqual((await fetch(restartUrl, options)).status, 200);
  assert.equal((await fetch(`${restartUrl}?relay_token=test-relay-token`, { method: "POST" })).status, 403);
  assert.deepEqual(restartCalls, []);
  const response = await fetch(restartUrl, { ...authorized, body: '{"AppServerPort":9999,"script":"untrusted.ps1"}' });
  assert.equal(response.status, 200);
  assert.match((await response.json()).message, /App Server 已重启/);
  assert.deepEqual(restartCalls, [{ appServerPort: 4500, relayPort: 4501, tokenFile: "local-test.token" }]);
});

test("restart is disabled for unconfigured tokens, unsupported platforms and nonlocal upstreams", async (t) => {
  for (const [options, status] of [[{ relayToken: "" }, 503], [{ platform: "linux" }, 501], [{ canRestart: false }, 501]]) {
    const { restartUrl, restartCalls } = await relay(t, options);
    assert.equal((await fetch(restartUrl, authorized)).status, status);
    assert.deepEqual(restartCalls, []);
  }
});

test("restart and desktop stop share an execution lock and a failed restart can be retried", async (t) => {
  let release;
  let attempts = 0;
  const { url, restartUrl, calls } = await relay(t, { restart: async () => {
    attempts += 1;
    if (attempts === 1) {
      await new Promise((resolve) => { release = resolve; });
      throw new Error("private-output");
    }
  } });
  const first = fetch(restartUrl, authorized);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await fetch(url, authorized)).status, 409);
  assert.equal((await fetch(restartUrl, authorized)).status, 409);
  assert.deepEqual(calls, []);
  release();
  const failed = await first;
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /private-output/);
  assert.equal((await fetch(restartUrl, authorized)).status, 200);
  assert.equal((await fetch(url, authorized)).status, 200);
});

test("concurrent stop requests are rejected and failure permits retry without leaking process output", async (t) => {
  let release;
  let attempts = 0;
  const { url } = await relay(t, { stop: async () => {
    attempts += 1;
    if (attempts === 1) {
      await new Promise((resolve) => { release = resolve; });
      throw new Error("private-token-and-process-output");
    }
  } });
  const first = fetch(url, authorized);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await fetch(url, authorized)).status, 409);
  release();
  const failed = await first;
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /private-token/);
  assert.equal((await fetch(url, authorized)).status, 200);
  assert.equal(attempts, 2);
});

function mobileControl(fetchImpl = fetch, timers = { setTimeout, clearTimeout }) {
  const source = readFileSync(new URL("../apps/mobile/src/hooks/codex-app-server/desktopControl.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, { exports, URL, AbortController, fetch: fetchImpl, ...timers });
  return exports;
}

test("mobile derives HTTP endpoint from the active relay and moves its token out of the URL", () => {
  const { buildDesktopStopRequest } = mobileControl();
  const request = buildDesktopStopRequest({ socketUrl: "wss://phone.example.com/chat?relay_token=token%2Bvalue&extra=1#fragment" });
  assert.equal(request.url, "https://phone.example.com/desktop/stop");
  assert.equal(request.headers.Authorization, "Bearer token+value");
  assert.throws(() => buildDesktopStopRequest({ socketUrl: "ws://127.0.0.1:4500", authToken: "capability-token" }), /Relay token/);
});

test("process control target survives an offline App Server and excludes credentials", () => {
  const api = mobileControl();
  assert.equal(api.getProcessControlTarget({ socketUrl: "wss://offline.example.com?relay_token=secret-value" }), "offline.example.com");
  assert.equal(api.getProcessControlTarget({ socketUrl: "ws://127.0.0.1:4501?relay_token=test-token" }), "127.0.0.1:4501");
  assert.equal(api.getProcessControlTarget(null), null);
  assert.equal(api.getProcessControlTarget({ socketUrl: "ws://127.0.0.1:4500", authToken: "capability-token" }), null);
});

test("mobile and real HTTP handler agree on authentication and result format", async (t) => {
  const { url, calls } = await relay(t);
  const connection = { socketUrl: `${url.replace("http:", "ws:")}?relay_token=test-relay-token` };
  assert.match(await mobileControl().requestDesktopStop(connection), /桌面端已关闭/);
  assert.equal(calls.length, 1);
});

test("mobile restart uses the active relay, keeps credentials out of the URL and returns completion", async (t) => {
  const { restartUrl, restartCalls } = await relay(t);
  const connection = { socketUrl: `${restartUrl.replace("http:", "ws:")}?relay_token=test-relay-token&other=value` };
  const api = mobileControl();
  const request = api.buildAppServerRestartRequest(connection);
  assert.equal(request.url, restartUrl);
  assert.equal(request.headers.Authorization, "Bearer test-relay-token");
  assert.match(await api.requestAppServerRestart(connection), /App Server 已重启/);
  assert.equal(restartCalls.length, 1);
  await assert.rejects(mobileControl(async () => ({ status: 500, ok: false, json: async () => ({ ok: false, message: "重启失败" }) })).requestAppServerRestart(connection), /重启失败/);
});

test("mobile explains old relay, authentication failure and timeout without retrying the stop", async () => {
  const connection = { socketUrl: "wss://phone.example.com?relay_token=test-relay-token" };
  await assert.rejects(mobileControl(async () => ({ status: 404 })).requestDesktopStop(connection), /重启 Relay/);
  await assert.rejects(mobileControl(async () => ({ status: 403, ok: false, json: async () => ({ ok: false, message: "Relay token 不正确" }) })).requestDesktopStop(connection), /Relay token 不正确/);
  let calls = 0;
  let triggerTimeout;
  const timeoutApi = mobileControl(async () => {
    calls += 1;
    triggerTimeout();
    throw new Error("network timeout");
  }, { setTimeout: (callback) => { triggerTimeout = callback; return 1; }, clearTimeout: () => {} });
  // 网络失败也只发送一次，避免未知执行状态下自动重复强制关闭。
  await assert.rejects(timeoutApi.requestDesktopStop(connection), /请求超时/);
  assert.equal(calls, 1);
});
