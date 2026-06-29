# Desktop Refresh Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local PC bridge script that keeps recently updated Codex app-server threads loaded and refreshed, so Codex Desktop is more likely to show mobile-sent messages when opening a thread.

**Architecture:** Add a standalone Node ESM script under `scripts/` that connects to `codex app-server` over WebSocket JSON-RPC, initializes the client, chooses target threads from an explicit thread id, loaded thread ids, and recent thread list, then calls `thread/resume`, `thread/read`, and `thread/turns/list`. Keep selection logic in pure exported functions for `node:test` coverage.

**Tech Stack:** Node.js built-ins only: `http`, `https`, `net`, `crypto`, `node:test`, and `assert`.

---

### Task 1: Bridge Strategy Tests

**Files:**
- Create: `scripts/desktop-refresh-bridge.test.mjs`

- [x] **Step 1: Write failing tests**

Add tests for target thread selection and refresh request generation.

- [x] **Step 2: Run tests to verify failure**

Run: `node --test scripts/desktop-refresh-bridge.test.mjs`
Expected: fail because `scripts/desktop-refresh-bridge.mjs` is not implemented yet.

### Task 2: Bridge Script

**Files:**
- Create: `scripts/desktop-refresh-bridge.mjs`

- [x] **Step 1: Implement pure strategy helpers**

Export `selectTargetThreadIds`, `buildThreadRefreshRequests`, and `parseBridgeConfig`.

- [x] **Step 2: Implement WebSocket JSON-RPC loop**

Connect to app-server, initialize, refresh target threads once or on an interval, and print compact status lines.

### Task 3: Commands And Verification

**Files:**
- Modify: `package.json`

- [x] **Step 1: Add package scripts**

Add `bridge:desktop-refresh` and `test:scripts`.

- [x] **Step 2: Run verification**

Run `pnpm test:scripts` and `pnpm typecheck`.
