import type { CommandExecutionRequestApprovalParams, FileUpdateChange, Thread, ThreadItem, Turn, TurnPlanStep, UserInput, WebSearchAction } from "@codex-mobile/protocol/v2";

export type TimelineEntry = {
  id: string;
  turnId?: string;
  role: "user" | "assistant" | "tool" | "system";
  variant?: "command" | "commandGroup" | "webSearchGroup" | "turnProcessGroup" | "contextCompaction";
  title: string;
  metaLabel?: string;
  timestampMs?: number;
  body: string;
  commandText?: string;
  commandStatus?: "inProgress" | "completed" | "failed" | "declined";
  commandExitCode?: number | null;
  commandOutput?: string;
  commandEntries?: TimelineEntry[];
  webSearchActions?: TimelineWebSearchAction[];
  processEntries?: TimelineEntry[];
  attachments?: TimelineAttachment[];
  fileChanges?: TimelineFileChange[];
  clientId?: string | null;
  pending?: boolean;
  failed?: boolean;
  streaming?: boolean;
};

export type TimelineWebSearchAction = {
  id: string;
  label: string;
  detail: string;
  icon: "search" | "open" | "find" | "other";
};

export type TimelineAttachment = {
  type: "image";
  uri: string;
  originalUri?: string;
  label: string;
};

export type TimelineFileChange = {
  path: string;
  status: "added" | "deleted" | "updated" | "moved";
  kind: string;
  diff: string;
  additions: number;
  deletions: number;
};

const MAX_TIMELINE_BODY_CHARS = 4000;

type CollabAgentToolCallItem = Extract<ThreadItem, { type: "collabAgentToolCall" }>;
type HookPromptItem = Extract<ThreadItem, { type: "hookPrompt" }>;
type ImageGenerationItem = Extract<ThreadItem, { type: "imageGeneration" }>;
type SubAgentActivityItem = Extract<ThreadItem, { type: "subAgentActivity" }>;

export function formatTime(seconds: number) {
  return new Date(seconds * 1000).toLocaleString();
}

export function threadTitle(thread: Thread) {
  return thread.name || thread.preview || thread.cwd || thread.id;
}

export function threadProjectLabel(thread: Thread) {
  const cwd = thread.cwd || "";
  const projectName = cwd.split("/").filter(Boolean).at(-1) || cwd || thread.name || thread.id;
  const branch = thread.gitInfo?.branch;
  return branch ? `${projectName} (${branch})` : projectName;
}

export function flattenTurns(turns: Turn[]) {
  return turns.flatMap((turn) => {
    const seenIds = new Map<string, number>();
    const lastAgentMessageIndex = findLastAgentMessageIndex(turn.items);
    return turn.items.map((item, index) =>
      itemToTimelineEntry(turn.id, item, seenIds, {
        timestampMs: getItemTimestampMs(item, turn),
        turnDurationMs: index === lastAgentMessageIndex ? turn.durationMs : null,
      }),
    );
  });
}

export function timelineEntryFromThreadItem(
  turnId: string,
  item: ThreadItem,
  options: { streaming?: boolean; timestampMs?: number | null; turnDurationMs?: number | null } = {},
) {
  return itemToTimelineEntry(turnId, item, undefined, options);
}

export function timelineEntryFromCommandApproval(params: CommandExecutionRequestApprovalParams): TimelineEntry {
  const command = params.command?.trim() || "命令";

  return {
    id: `${params.turnId}:${params.itemId}`,
    turnId: params.turnId,
    role: "tool",
    variant: "command",
    title: formatCommandExecutionTitle("inProgress", command),
    timestampMs: params.startedAtMs,
    body: params.reason ? `等待允许：${params.reason}` : "",
    commandText: command,
    commandStatus: "inProgress",
    commandExitCode: null,
    commandOutput: "",
  };
}

export function appendTimelineBody(body: string, delta: string) {
  return clipTimelineBody(`${body}${delta}`);
}

export function timelineEntryFromTurnPlan(turnId: string, explanation: string | null, plan: TurnPlanStep[]): TimelineEntry {
  return {
    id: `${turnId}:turn-plan`,
    turnId,
    role: "assistant",
    title: "Plan",
    body: clipTimelineBody(formatTurnPlanBody(explanation, plan)),
    streaming: plan.some((step) => step.status === "inProgress"),
  };
}

export function timelineEntryFromTurnDiff(turnId: string, diff: string): TimelineEntry {
  const change: FileUpdateChange = {
    path: "当前 turn 变更",
    kind: { type: "update", move_path: null },
    diff,
  };

  return {
    id: `${turnId}:turn-diff`,
    turnId,
    role: "tool",
    title: "实时文件变更",
    body: formatFileChangesSummary([change]),
    fileChanges: [formatTimelineFileChange(change)],
    streaming: true,
  };
}

export function timelineEntryFromFileChangePatch(turnId: string, itemId: string, changes: FileUpdateChange[]): TimelineEntry {
  return {
    id: `${turnId}:${itemId}`,
    turnId,
    role: "tool",
    title: `正在编辑 ${changes.length} 个文件`,
    body: formatFileChangesSummary(changes),
    fileChanges: changes.map(formatTimelineFileChange),
    streaming: true,
  };
}

function itemToTimelineEntry(
  turnId: string,
  item: ThreadItem,
  seenIds?: Map<string, number>,
  options: { streaming?: boolean; timestampMs?: number | null; turnDurationMs?: number | null } = {},
): TimelineEntry {
  const entryId = buildTimelineEntryId(turnId, item, seenIds);

  switch (item.type) {
    case "userMessage":
      return { ...formatUserMessageEntry(entryId, item.content, options.timestampMs, item.clientId), turnId };
    case "hookPrompt":
      return {
        id: entryId,
        turnId,
        role: "system",
        title: "Hook 提示",
        timestampMs: options.timestampMs ?? undefined,
        body: clipTimelineBody(formatHookPromptBody(item.fragments)),
        streaming: options.streaming,
      };
    case "agentMessage":
      return {
        id: entryId,
        turnId,
        role: "assistant",
        title: "Codex",
        metaLabel: formatDurationMeta(options.turnDurationMs),
        timestampMs: options.timestampMs ?? undefined,
        body: clipTimelineBody(item.text),
        streaming: options.streaming,
      };
    case "reasoning":
      return {
        id: entryId,
        turnId,
        role: "assistant",
        title: "Reasoning",
        timestampMs: options.timestampMs ?? undefined,
        body: clipTimelineBody([...item.summary, ...item.content].join("\n")),
      };
    case "commandExecution":
      return {
        id: entryId,
        turnId,
        role: "tool",
        variant: "command",
        title: formatCommandExecutionTitle(item.status, item.command),
        metaLabel: formatDurationMeta(item.durationMs),
        timestampMs: options.timestampMs ?? undefined,
        body: formatCommandExecutionOutput(item.aggregatedOutput || ""),
        commandText: item.command,
        commandStatus: item.status,
        commandExitCode: item.exitCode,
        commandOutput: item.aggregatedOutput || "",
      };
    case "fileChange":
      return {
        id: entryId,
        turnId,
        role: "tool",
        title: `已编辑 ${item.changes.length} 个文件`,
        timestampMs: options.timestampMs ?? undefined,
        body: formatFileChangesSummary(item.changes),
        fileChanges: item.changes.map(formatTimelineFileChange),
      };
    case "plan":
      return {
        id: entryId,
        turnId,
        role: "assistant",
        title: "Plan",
        timestampMs: options.timestampMs ?? undefined,
        body: clipTimelineBody(item.text),
      };
    case "mcpToolCall":
      return {
        id: entryId,
        turnId,
        role: "tool",
        title: item.status,
        metaLabel: formatDurationMeta(item.durationMs),
        timestampMs: options.timestampMs ?? undefined,
        body: clipTimelineBody(`${item.server}/${item.tool}`),
      };
    case "dynamicToolCall":
      return {
        id: entryId,
        turnId,
        role: "tool",
        title: item.status,
        metaLabel: formatDurationMeta(item.durationMs),
        timestampMs: options.timestampMs ?? undefined,
        body: clipTimelineBody(item.namespace ? `${item.namespace}/${item.tool}` : item.tool),
      };
    case "collabAgentToolCall":
      return {
        id: entryId,
        turnId,
        role: "tool",
        title: formatCollabAgentToolTitle(item),
        timestampMs: options.timestampMs ?? undefined,
        body: clipTimelineBody(formatCollabAgentToolBody(item)),
        streaming: options.streaming || item.status === "inProgress",
      };
    case "subAgentActivity":
      return {
        id: entryId,
        turnId,
        role: "tool",
        title: formatSubAgentActivityTitle(item),
        timestampMs: options.timestampMs ?? undefined,
        body: clipTimelineBody(formatSubAgentActivityBody(item)),
      };
    case "webSearch": {
      const action = formatWebSearchAction(item.query, item.action);
      return {
        id: entryId,
        turnId,
        role: "tool",
        title: options.streaming ? "正在搜索网页" : "已搜索网页",
        timestampMs: options.timestampMs ?? undefined,
        body: action.detail,
        streaming: options.streaming,
        webSearchActions: [{ id: entryId, ...action }],
      };
    }
    case "imageView":
      return {
        id: entryId,
        turnId,
        role: "assistant",
        title: "图片",
        timestampMs: options.timestampMs ?? undefined,
        body: "",
        attachments: [
          {
            type: "image",
            uri: item.path,
            label: "图片",
          },
        ],
        streaming: options.streaming,
      };
    case "imageGeneration": {
      const attachmentUri = getImageGenerationAttachmentUri(item);
      return {
        id: entryId,
        turnId,
        role: "assistant",
        title: "生成图片",
        timestampMs: options.timestampMs ?? undefined,
        body: clipTimelineBody(formatImageGenerationBody(item, Boolean(attachmentUri))),
        attachments: attachmentUri
          ? [
              {
                type: "image",
                uri: attachmentUri,
                label: "生成图片",
              },
            ]
          : undefined,
        streaming: options.streaming || item.status === "inProgress",
      };
    }
    case "sleep":
      return {
        id: entryId,
        turnId,
        role: "system",
        title: "等待",
        timestampMs: options.timestampMs ?? undefined,
        body: `等待 ${formatDuration(item.durationMs)}`,
      };
    case "enteredReviewMode":
      return {
        id: entryId,
        turnId,
        role: "system",
        title: "Review 模式",
        timestampMs: options.timestampMs ?? undefined,
        body: clipTimelineBody(`已进入 Review 模式\n${item.review}`),
      };
    case "exitedReviewMode":
      return {
        id: entryId,
        turnId,
        role: "system",
        title: "Review 模式",
        timestampMs: options.timestampMs ?? undefined,
        body: clipTimelineBody(`已退出 Review 模式\n${item.review}`),
      };
    case "contextCompaction":
      return {
        id: entryId,
        turnId,
        role: "system",
        variant: "contextCompaction",
        title: "系统消息",
        timestampMs: options.timestampMs ?? undefined,
        body: "上下文已压缩，后续回复会基于压缩后的上下文继续。",
      };
    default: {
      const unhandledItem: never = item;
      return {
        // item.id 在不同 turn 之间不保证全局唯一，时间线 key 必须带上 turnId。
        id: entryId,
        turnId,
        role: "system",
        title: "未知消息",
        timestampMs: options.timestampMs ?? undefined,
        body: clipTimelineBody(JSON.stringify(unhandledItem, null, 2)),
      };
    }
  }
}

function getItemTimestampMs(item: ThreadItem, turn: Turn) {
  if (item.type === "userMessage") {
    return secondsToMs(turn.startedAt);
  }

  return secondsToMs(turn.completedAt ?? turn.startedAt);
}

function secondsToMs(seconds: number | null | undefined) {
  return seconds ? seconds * 1000 : undefined;
}

function findLastAgentMessageIndex(items: ThreadItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.type === "agentMessage") {
      return index;
    }
  }

  return -1;
}

function formatHookPromptBody(fragments: HookPromptItem["fragments"]) {
  const body = fragments.map((fragment) => fragment.text.trim()).filter(Boolean).join("\n\n");
  return body || "Hook 提示已注入。";
}

function formatCollabAgentToolTitle(item: CollabAgentToolCallItem) {
  return `协作 Agent ${formatCollabAgentToolName(item.tool)} · ${formatCollabAgentStatus(item.status)}`;
}

function formatCollabAgentToolBody(item: CollabAgentToolCallItem) {
  const lines = [
    `工具：${formatCollabAgentToolName(item.tool)}`,
    `状态：${formatCollabAgentStatus(item.status)}`,
    `发起线程：${item.senderThreadId}`,
    item.receiverThreadIds.length ? `目标线程：${item.receiverThreadIds.length} 个` : null,
    item.model ? `模型：${item.model}` : null,
    item.reasoningEffort ? `推理强度：${item.reasoningEffort}` : null,
    item.prompt ? `输入：${summarizeInlineText(item.prompt, 600)}` : null,
    Object.keys(item.agentsStates).length ? `Agent 状态：${Object.keys(item.agentsStates).length} 个` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

function formatCollabAgentToolName(tool: CollabAgentToolCallItem["tool"]) {
  switch (tool) {
    case "spawnAgent":
      return "启动 Agent";
    case "sendInput":
      return "发送输入";
    case "resumeAgent":
      return "恢复 Agent";
    case "wait":
      return "等待";
    case "closeAgent":
      return "关闭 Agent";
  }
}

function formatCollabAgentStatus(status: CollabAgentToolCallItem["status"]) {
  switch (status) {
    case "inProgress":
      return "进行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
  }
}

function formatSubAgentActivityTitle(item: SubAgentActivityItem) {
  return `子 Agent · ${formatSubAgentActivityKind(item.kind)}`;
}

function formatSubAgentActivityBody(item: SubAgentActivityItem) {
  return [`线程：${item.agentThreadId}`, `路径：${item.agentPath}`].join("\n");
}

function formatSubAgentActivityKind(kind: SubAgentActivityItem["kind"]) {
  switch (kind) {
    case "started":
      return "已启动";
    case "interacted":
      return "已交互";
    case "interrupted":
      return "已中断";
  }
}

function getImageGenerationAttachmentUri(item: ImageGenerationItem) {
  if (item.savedPath) {
    return item.savedPath;
  }

  const result = item.result.trim();
  if (!result) {
    return null;
  }

  if (isImageUriLike(result)) {
    return result;
  }

  if (isLikelyBase64Image(result)) {
    return `data:image/png;base64,${result.replace(/\s/g, "")}`;
  }

  return null;
}

function formatImageGenerationBody(item: ImageGenerationItem, hasAttachment: boolean) {
  const lines = [
    `图片生成：${formatImageGenerationStatus(item.status)}`,
    item.revisedPrompt ? `提示词：${item.revisedPrompt}` : null,
    !hasAttachment && item.result.trim() ? `结果：${summarizeInlineText(item.result.trim(), 800)}` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

function formatImageGenerationStatus(status: string) {
  switch (status) {
    case "inProgress":
      return "生成中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return status || "未知";
  }
}

function isImageUriLike(value: string) {
  return value.startsWith("data:image/") || /^https?:\/\//.test(value) || value.startsWith("file://") || isHostFilePathLike(value);
}

function isHostFilePathLike(value: string) {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);
}

function isLikelyBase64Image(value: string) {
  const normalized = value.replace(/\s/g, "");
  return normalized.length > 200 && normalized.length % 4 === 0 && /^[a-zA-Z0-9+/]+={0,2}$/.test(normalized);
}

function summarizeInlineText(text: string, maxLength: number) {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...[truncated ${text.length - maxLength} chars]`;
}

function formatUserMessageEntry(id: string, content: UserInput[], timestampMs?: number | null, clientId?: string | null): TimelineEntry {
  const bodyParts: string[] = [];
  const attachments: TimelineAttachment[] = [];

  for (const input of content) {
    if (input.type === "image") {
      attachments.push({
        type: "image",
        uri: input.url,
        label: "图片",
      });
      continue;
    }

    if (input.type === "localImage") {
      attachments.push({
        type: "image",
        uri: input.path,
        label: "本地图片",
      });
      continue;
    }

    bodyParts.push(formatUserInputText(input));
  }

  return {
    id,
    role: "user",
    title: "You",
    timestampMs: timestampMs ?? undefined,
    body: clipTimelineBody(bodyParts.filter(Boolean).join("\n")),
    attachments,
    clientId,
  };
}

function formatTurnPlanBody(explanation: string | null, plan: TurnPlanStep[]) {
  const lines = plan.map((step) => `${formatPlanStepStatus(step.status)} ${step.step}`);
  return [explanation, ...lines].filter(Boolean).join("\n");
}

function formatPlanStepStatus(status: TurnPlanStep["status"]) {
  switch (status) {
    case "pending":
      return "[ ]";
    case "inProgress":
      return "[~]";
    case "completed":
      return "[x]";
  }
}

function formatUserInputText(input: UserInput) {
  switch (input.type) {
    case "text":
      return input.text;
    case "skill":
      return `@${input.name}`;
    case "mention":
      return `@${input.name}`;
    case "image":
    case "localImage":
      return "";
  }
}

function formatCommandExecutionTitle(status: "inProgress" | "completed" | "failed" | "declined", command: string) {
  const shortCommand = command.trim() || "命令";

  switch (status) {
    case "inProgress":
      return `正在运行 ${shortCommand}`;
    case "completed":
      return `已运行 ${shortCommand}`;
    case "failed":
      return `运行失败 ${shortCommand}`;
    case "declined":
      return `已拒绝 ${shortCommand}`;
  }
}

function formatCommandExecutionOutput(output: string) {
  if (!output.trim()) {
    return "";
  }

  return clipTimelineBody(summarizeToolOutput(output));
}

function formatWebSearchAction(query: string, action: WebSearchAction | null): Omit<TimelineWebSearchAction, "id"> {
  if (!action) {
    return {
      label: "搜索网页",
      detail: query || "搜索网页",
      icon: "search",
    };
  }

  switch (action.type) {
    case "search": {
      const queries = action.queries?.filter(Boolean) ?? [];
      const searchText = queries.length ? queries.join("\n") : action.query || query || "搜索网页";
      return {
        label: queries.length > 1 ? `搜索网页 ${queries.length} 次` : "搜索网页",
        detail: searchText,
        icon: "search",
      };
    }
    case "openPage":
      return {
        label: "打开网页",
        detail: action.url || query || "打开网页",
        icon: "open",
      };
    case "findInPage":
      return {
        label: "页内查找",
        detail: [action.pattern, action.url].filter(Boolean).join(" · ") || query || "页内查找",
        icon: "find",
      };
    case "other":
      return {
        label: "网页操作",
        detail: query || "网页操作",
        icon: "other",
      };
  }
}

function formatDurationMeta(durationMs: number | null | undefined) {
  if (!durationMs || durationMs < 0) {
    return undefined;
  }

  return `已处理 ${formatDuration(durationMs)}`;
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function summarizeToolOutput(output: string) {
  const trimmed = output.trim();

  if (trimmed.length <= 1800) {
    return trimmed;
  }

  // 工具输出经常很长，移动端默认保留头尾，完整内容仍可在桌面端看。
  const head = trimmed.slice(0, 900);
  const tail = trimmed.slice(-700);
  return `${head}\n\n...[omitted ${trimmed.length - head.length - tail.length} chars]...\n\n${tail}`;
}

function formatFileChangesSummary(changes: FileUpdateChange[]) {
  if (changes.length === 0) {
    return "No file changes";
  }

  const totals = changes.reduce(
    (next, change) => {
      const stats = countDiffStats(change.diff);
      return {
        additions: next.additions + stats.additions,
        deletions: next.deletions + stats.deletions,
      };
    },
    { additions: 0, deletions: 0 },
  );

  return `已编辑 ${changes.length} 个文件  +${totals.additions} -${totals.deletions}`;
}

function formatTimelineFileChange(change: FileUpdateChange): TimelineFileChange {
  const stats = countDiffStats(change.diff);
  return {
    path: change.path,
    status: formatPatchStatus(change),
    kind: formatPatchKind(change),
    diff: change.diff,
    additions: stats.additions,
    deletions: stats.deletions,
  };
}

function countDiffStats(diff: string) {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }

    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function formatPatchKind(change: FileUpdateChange) {
  switch (change.kind.type) {
    case "add":
      return "新增";
    case "delete":
      return "删除";
    case "update":
      return change.kind.move_path ? "移动" : "修改";
  }
}

function formatPatchStatus(change: FileUpdateChange): TimelineFileChange["status"] {
  switch (change.kind.type) {
    case "add":
      return "added";
    case "delete":
      return "deleted";
    case "update":
      return change.kind.move_path ? "moved" : "updated";
  }
}

export function clipTimelineBody(text: string) {
  if (text.length <= MAX_TIMELINE_BODY_CHARS) {
    return text;
  }

  return `${text.slice(0, MAX_TIMELINE_BODY_CHARS)}\n\n...[truncated ${text.length - MAX_TIMELINE_BODY_CHARS} chars]`;
}

function buildTimelineEntryId(turnId: string, item: ThreadItem, seenIds?: Map<string, number>) {
  const baseId = `${turnId}:${item.id || item.type}`;

  if (!seenIds) {
    return baseId;
  }

  const count = seenIds.get(baseId) ?? 0;
  seenIds.set(baseId, count + 1);

  return count === 0 ? baseId : `${baseId}:${count}`;
}
