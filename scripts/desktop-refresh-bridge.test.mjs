import assert from "node:assert/strict";
import test from "node:test";

import {
  buildThreadRefreshRequests,
  createNotificationRefreshScheduler,
  extractRefreshThreadId,
  parseBridgeConfig,
  selectTargetThreadIds,
} from "./desktop-refresh-bridge.mjs";

test("prefers explicit thread id over loaded and recent threads", () => {
  const targets = selectTargetThreadIds({
    explicitThreadId: "thread-explicit",
    loadedThreadIds: ["thread-loaded"],
    recentThreads: [{ id: "thread-recent", cwd: "/repo/a" }],
    cwd: null,
    maxRecentThreads: 3,
  });

  assert.deepEqual(targets, ["thread-explicit"]);
});

test("combines loaded threads with recent threads and dedupes in stable order", () => {
  const targets = selectTargetThreadIds({
    explicitThreadId: null,
    loadedThreadIds: ["thread-a", "thread-b"],
    recentThreads: [
      { id: "thread-b", cwd: "/repo/a" },
      { id: "thread-c", cwd: "/repo/a" },
      { id: "thread-d", cwd: "/repo/b" },
    ],
    cwd: null,
    maxRecentThreads: 2,
  });

  assert.deepEqual(targets, ["thread-a", "thread-b", "thread-c"]);
});

test("filters recent threads by cwd without dropping already loaded threads", () => {
  const targets = selectTargetThreadIds({
    explicitThreadId: null,
    loadedThreadIds: ["thread-loaded"],
    recentThreads: [
      { id: "thread-a", cwd: "/repo/a" },
      { id: "thread-b", cwd: "/repo/b" },
    ],
    cwd: "/repo/b",
    maxRecentThreads: 5,
  });

  assert.deepEqual(targets, ["thread-loaded", "thread-b"]);
});

test("builds the refresh request sequence for a thread", () => {
  assert.deepEqual(buildThreadRefreshRequests("thread-1"), [
    {
      method: "thread/resume",
      params: {
        threadId: "thread-1",
        excludeTurns: true,
        initialTurnsPage: {
          limit: 4,
          sortDirection: "desc",
          itemsView: "full",
        },
        persistExtendedHistory: false,
      },
    },
    {
      method: "thread/read",
      params: {
        threadId: "thread-1",
        includeTurns: true,
      },
    },
    {
      method: "thread/turns/list",
      params: {
        threadId: "thread-1",
        cursor: null,
        limit: 4,
        sortDirection: "desc",
        itemsView: "full",
      },
    },
  ]);
});

test("parses bridge env with safe defaults", () => {
  const config = parseBridgeConfig({
    CODEX_APP_SERVER_URL: "ws://127.0.0.1:4500",
    DESKTOP_REFRESH_BRIDGE_ONCE: "1",
    DESKTOP_REFRESH_BRIDGE_INTERVAL_MS: "500",
    DESKTOP_REFRESH_BRIDGE_MAX_RECENT: "7",
    DESKTOP_REFRESH_BRIDGE_THREAD_ID: "thread-1",
    DESKTOP_REFRESH_BRIDGE_CWD: "/repo/a",
  });

  assert.equal(config.url.toString(), "ws://127.0.0.1:4500/");
  assert.equal(config.once, true);
  assert.equal(config.intervalMs, 500);
  assert.equal(config.maxRecentThreads, 7);
  assert.equal(config.threadId, "thread-1");
  assert.equal(config.cwd, "/repo/a");
});

test("extracts refresh thread id from app-server thread notifications", () => {
  assert.equal(
    extractRefreshThreadId({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
      },
    }),
    "thread-1",
  );

  assert.equal(
    extractRefreshThreadId({
      method: "thread/started",
      params: {
        thread: {
          id: "thread-2",
        },
      },
    }),
    "thread-2",
  );
});

test("ignores unrelated notifications and json-rpc responses", () => {
  assert.equal(extractRefreshThreadId({ id: 1, result: {} }), null);
  assert.equal(extractRefreshThreadId({ method: "account/updated", params: { threadId: "thread-1" } }), null);
  assert.equal(extractRefreshThreadId({ method: "turn/completed", params: {} }), null);
});

test("debounces notification refreshes for the same thread", async () => {
  const timers = [];
  const refreshed = [];
  const cleared = [];
  const scheduler = createNotificationRefreshScheduler({
    debounceMs: 25,
    refreshThread: async (threadId) => {
      refreshed.push(threadId);
    },
    setTimeoutFn: (callback, ms) => {
      const timer = {
        callback,
        ms,
        cancelled: false,
      };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: (timer) => {
      timer.cancelled = true;
      cleared.push(timer);
    },
  });

  scheduler.handleNotification({ method: "item/completed", params: { threadId: "thread-1" } });
  scheduler.handleNotification({ method: "turn/completed", params: { threadId: "thread-1" } });
  scheduler.handleNotification({ method: "turn/completed", params: { threadId: "thread-2" } });

  assert.equal(timers.length, 3);
  assert.equal(cleared.length, 1);
  assert.equal(timers[0].cancelled, true);
  for (const timer of timers) {
    if (!timer.cancelled) {
      await timer.callback();
    }
  }

  assert.deepEqual(refreshed, ["thread-1", "thread-2"]);
});
