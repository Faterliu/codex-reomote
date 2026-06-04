import type { FileUpdateChange, TurnPlanStep } from "@codex-mobile/protocol/v2";

import {
  applyMcpToolCallProgress,
  applyReasoningDelta,
  applyThreadCompacted,
  applyFileChangePatchUpdated,
  applyPlanDelta,
  resolveOlderTurnsCursor,
  applyTurnDiffUpdated,
  applyTurnPlanUpdated,
  isSameTimeline,
  mergeTimelineSnapshot,
} from "./timelineState";

const plan: TurnPlanStep[] = [
  { step: "检查协议", status: "completed" },
  { step: "接入通知", status: "inProgress" },
];

const fileChanges: FileUpdateChange[] = [
  {
    path: "apps/mobile/App.tsx",
    kind: { type: "update", move_path: null },
    diff: "--- a/apps/mobile/App.tsx\n+++ b/apps/mobile/App.tsx\n+const ok = true;",
  },
];

const afterPlan = applyTurnPlanUpdated([], "turn-1", "按计划推进", plan);
afterPlan[0]?.title satisfies string | undefined;

const afterPlanDelta = applyPlanDelta(afterPlan, "turn-1", "plan-item", "增量计划");
afterPlanDelta[0]?.streaming satisfies boolean | undefined;

const afterDiff = applyTurnDiffUpdated(afterPlanDelta, "turn-1", fileChanges[0]?.diff ?? "");
afterDiff[0]?.fileChanges?.[0]?.status satisfies "added" | "deleted" | "updated" | "moved" | undefined;

const afterPatch = applyFileChangePatchUpdated(afterDiff, "turn-1", "file-item", fileChanges);
afterPatch[0]?.fileChanges?.[0]?.path satisfies string | undefined;

const afterReasoning = applyReasoningDelta(afterPatch, "turn-1", "reasoning-item", "推理中", "Reasoning");
afterReasoning[0]?.title satisfies string | undefined;

const afterMcp = applyMcpToolCallProgress(afterReasoning, "turn-1", "mcp-item", "正在读取资源");
afterMcp[0]?.body satisfies string | undefined;

const afterCompacted = applyThreadCompacted(afterMcp, "turn-1");
afterCompacted[0]?.role satisfies "user" | "assistant" | "tool" | "system" | undefined;

const resolvedCursor = resolveOlderTurnsCursor(
  "older-cursor",
  "first-page-cursor",
  [{ id: "old:user", turnId: "old", role: "user", title: "You", body: "旧消息" }],
  [{ id: "new:user", turnId: "new", role: "user", title: "You", body: "新消息" }],
);
resolvedCursor satisfies string | null;

const exhaustedCursor = resolveOlderTurnsCursor(
  null,
  "first-page-cursor",
  [{ id: "old:user", turnId: "old", role: "user", title: "You", body: "旧消息" }],
  [{ id: "new:user", turnId: "new", role: "user", title: "You", body: "新消息" }],
);
exhaustedCursor satisfies string | null;

const activeSnapshotMerge = mergeTimelineSnapshot(
  [
    { id: "old:user", turnId: "old", role: "user", title: "You", body: "旧消息" },
    { id: "active:user", turnId: "active", role: "user", title: "You", body: "继续" },
    { id: "active:assistant", turnId: "active", role: "assistant", title: "Codex", body: "本地流式内容", streaming: true },
  ],
  [
    { id: "active:user", turnId: "active", role: "user", title: "You", body: "继续" },
    { id: "active:assistant", turnId: "active", role: "assistant", title: "Codex", body: "旧快照", streaming: true },
    { id: "latest:assistant", turnId: "latest", role: "assistant", title: "Codex", body: "最新完成消息" },
  ],
  { preserveTurnIds: ["active"] },
);
activeSnapshotMerge[0]?.body satisfies string | undefined;
activeSnapshotMerge.find((entry) => entry.id === "active:assistant")?.streaming satisfies boolean | undefined;

const timelineChanged = isSameTimeline(
  [{ id: "same", role: "assistant", title: "Codex", body: "内容", streaming: true }],
  [{ id: "same", role: "assistant", title: "Codex", body: "内容", streaming: false }],
);
timelineChanged satisfies boolean;
