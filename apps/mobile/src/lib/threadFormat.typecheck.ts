import { timelineEntryFromThreadItem } from "./threadFormat";

const hookPromptEntry = timelineEntryFromThreadItem("turn-hook", {
  type: "hookPrompt",
  id: "hook-1",
  fragments: [{ text: "Hook added context", hookRunId: "run-1" }],
});

hookPromptEntry.body satisfies string;

const imageViewEntry = timelineEntryFromThreadItem("turn-image", {
  type: "imageView",
  id: "image-1",
  path: "/tmp/codex-output.png",
});

imageViewEntry.role satisfies "user" | "assistant" | "tool" | "system";
imageViewEntry.body satisfies string;
imageViewEntry.attachments?.[0]?.uri satisfies string | undefined;
imageViewEntry.attachments?.[0]?.label satisfies string | undefined;

const collabAgentEntry = timelineEntryFromThreadItem("turn-collab", {
  type: "collabAgentToolCall",
  id: "collab-1",
  tool: "spawnAgent",
  status: "completed",
  senderThreadId: "thread-parent",
  receiverThreadIds: ["thread-child"],
  prompt: "review this change",
  model: "gpt-5",
  reasoningEffort: null,
  agentsStates: {},
});

collabAgentEntry.title satisfies string;
collabAgentEntry.body satisfies string;

const imageGenerationEntry = timelineEntryFromThreadItem("turn-image-generation", {
  type: "imageGeneration",
  id: "image-generation-1",
  status: "completed",
  revisedPrompt: "A mobile screenshot",
  result: "/tmp/generated.png",
  savedPath: "/tmp/generated.png",
});

imageGenerationEntry.body satisfies string;
imageGenerationEntry.attachments?.[0]?.uri satisfies string | undefined;

const enteredReviewEntry = timelineEntryFromThreadItem("turn-review", {
  type: "enteredReviewMode",
  id: "review-entered",
  review: "uncommittedChanges",
});

enteredReviewEntry.body satisfies string;

const exitedReviewEntry = timelineEntryFromThreadItem("turn-review", {
  type: "exitedReviewMode",
  id: "review-exited",
  review: "uncommittedChanges",
});

exitedReviewEntry.body satisfies string;

const contextCompactionEntry = timelineEntryFromThreadItem("turn-compaction", {
  type: "contextCompaction",
  id: "context-compaction-1",
});

contextCompactionEntry.body satisfies string;
