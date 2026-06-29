import assert from "node:assert/strict";
import test from "node:test";

import { buildUpstreamRequestOptions, describeUpstream } from "./app-server-relay-upstream.mjs";

test("uses tcp websocket upstream by default", () => {
  const options = buildUpstreamRequestOptions({
    upstreamUrl: new URL("ws://127.0.0.1:4500/app"),
    upstreamToken: "token-1",
    websocketKey: "key-1",
  });

  assert.equal(options.host, "127.0.0.1");
  assert.equal(options.port, "4500");
  assert.equal(options.path, "/app");
  assert.equal(options.socketPath, undefined);
  assert.equal(options.headers.Authorization, "Bearer token-1");
});

test("uses unix socket upstream when socket path is configured", () => {
  const options = buildUpstreamRequestOptions({
    upstreamUnixSocket: "/tmp/codex-app-server.sock",
    upstreamUrl: new URL("ws://127.0.0.1:4500/ignored"),
    upstreamToken: "token-1",
    websocketKey: "key-1",
  });

  assert.equal(options.socketPath, "/tmp/codex-app-server.sock");
  assert.equal(options.path, "/");
  assert.equal(options.host, undefined);
  assert.equal(options.port, undefined);
  assert.equal(options.headers.Authorization, undefined);
});

test("describes active upstream without leaking tokens", () => {
  assert.equal(
    describeUpstream({
      upstreamUnixSocket: "/tmp/codex-app-server.sock",
      upstreamUrl: new URL("ws://127.0.0.1:4500"),
    }),
    "unix:///tmp/codex-app-server.sock",
  );
});
