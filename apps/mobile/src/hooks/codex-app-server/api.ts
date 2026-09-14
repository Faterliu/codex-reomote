import type {
  ModelListResponse,
  ModelListParams,
  PermissionProfileListParams,
  PermissionProfileListResponse,
  PluginInstalledParams,
  PluginInstalledResponse,
  PluginSummary,
  ReviewStartParams,
  ReviewStartResponse,
  SkillsListResponse,
  SkillsListParams,
  Thread,
  ThreadArchiveParams,
  ThreadForkParams,
  ThreadForkResponse,
  ThreadListResponse,
  ThreadListParams,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadSettingsUpdateParams,
  ThreadSettingsUpdateResponse,
  ThreadSetNameParams,
  ThreadTurnsListParams,
  ThreadTurnsListResponse,
  ThreadUnarchiveParams,
  ThreadUnarchiveResponse,
  Turn,
  TurnStartParams,
  TurnStartResponse,
  TurnSteerParams,
  TurnSteerResponse,
  UserInput,
  GetAccountRateLimitsResponse,
} from "@codex-mobile/protocol/v2";

import { JsonRpcClient } from "@/lib/jsonRpcClient";
import type { ReadinessStatus } from "@/types/codex";

import type { NormalizedConnection } from "./types";
import type { PermissionModeId } from "@/types/permissionMode";
import { getPermissionMode, getPermissionModeSandboxPolicy, isBuiltInPermissionModeId } from "@/types/permissionMode";

export const DETAIL_TURN_PAGE_SIZE = 4;

export async function ensureThreadResumed(client: JsonRpcClient, thread: Thread) {
  const resumed = await resumeThreadWithInitialTurnPage(client, thread);
  return resumed.thread;
}

export async function resumeThreadWithInitialTurnPage(
  client: JsonRpcClient,
  thread: Thread,
  options: { force?: boolean; requireThreadSettings?: boolean } = {},
) {
  // 未真正走 thread/resume 时拿不到 thread 级设置。发送消息等调用方保留当前值即可，
  // 但打开会话必须拿权威设置，否则会把上一个会话的模型/思考程度带过来。
  if (!options.force && !options.requireThreadSettings && thread.status.type !== "notLoaded") {
    return {
      thread,
      initialTurnsPage: null,
      model: undefined,
      reasoningEffort: undefined,
    };
  }

  // 运行中的 thread 也需要重新 resume，app-server 会在 attach listener 后重放未决审批 request。
  const params: ThreadResumeParams = {
    threadId: thread.id,
    excludeTurns: true,
    initialTurnsPage: {
      limit: DETAIL_TURN_PAGE_SIZE,
      sortDirection: "desc",
      itemsView: "full",
    },
  };
  const resumed = await client.request<ThreadResumeResponse>("thread/resume", params);

  return {
    thread: resumed.thread,
    // thread 级 model / reasoningEffort 只由 thread/resume 返回，用于回填移动端的模型与「思考程度」。
    model: resumed.model,
    reasoningEffort: resumed.reasoningEffort,
    initialTurnsPage: resumed.initialTurnsPage
      ? {
          turns: [...resumed.initialTurnsPage.data].reverse(),
          nextCursor: resumed.initialTurnsPage.nextCursor,
        }
      : null,
  };
}

/**
 * 本机 codex app-server（0.153.4）的 thread/fork 支持 lastTurnId，但 packages/protocol 里
 * 生成版本的 ThreadForkParams 早于该字段。这里做一次性局部扩展而不再手工维护整份类型，
 * 等 `pnpm protocol:generate` 与协议版本对齐后可直接删除这个交叉类型。
 */
export type ThreadForkAtTurnParams = ThreadForkParams & {
  /** fork 到这一轮为止，包含该轮；指向的 turn 不能仍在执行中。 */
  lastTurnId: string;
};

export async function forkThreadAtTurn(client: JsonRpcClient, threadId: string, lastTurnId: string) {
  if (!threadId) {
    throw new Error("Missing threadId");
  }

  if (!lastTurnId) {
    throw new Error("Missing lastTurnId");
  }

  const params: ThreadForkAtTurnParams = { threadId, lastTurnId };
  const response = await client.request<ThreadForkResponse>("thread/fork", params);

  return response.thread;
}

export async function startTurn(
  client: JsonRpcClient,
  threadId: string,
  input: UserInput[],
  options: { clientUserMessageId?: string; cwd?: string; model?: string | null; effort?: string | null; permissionMode?: PermissionModeId } = {},
) {
  const permissionMode = options.permissionMode && isBuiltInPermissionModeId(options.permissionMode) ? getPermissionMode(options.permissionMode) : null;

  const params: TurnStartParams = {
    threadId,
    clientUserMessageId: options.clientUserMessageId,
    model: options.model ?? undefined,
    effort: options.effort ?? undefined,
    approvalsReviewer: permissionMode?.approvalsReviewer,
    permissions: options.permissionMode && !isBuiltInPermissionModeId(options.permissionMode) ? options.permissionMode : undefined,
    sandboxPolicy: permissionMode && options.cwd ? getPermissionModeSandboxPolicy(permissionMode.id, options.cwd) : undefined,
    input,
  };
  await client.request<TurnStartResponse>("turn/start", params);
}

export async function steerTurn(client: JsonRpcClient, threadId: string, turnId: string, input: UserInput[], clientUserMessageId?: string) {
  const params: TurnSteerParams = {
    threadId,
    expectedTurnId: turnId,
    clientUserMessageId,
    input,
  };
  await client.request<TurnSteerResponse>("turn/steer", params);
}

export async function setThreadName(client: JsonRpcClient, threadId: string, name: string) {
  const params: ThreadSetNameParams = { threadId, name };
  await client.request("thread/name/set", params);
}

export async function archiveThread(client: JsonRpcClient, threadId: string) {
  const params: ThreadArchiveParams = { threadId };
  await client.request("thread/archive", params);
}

export async function unarchiveThread(client: JsonRpcClient, threadId: string) {
  const params: ThreadUnarchiveParams = { threadId };
  return client.request<ThreadUnarchiveResponse>("thread/unarchive", params);
}

export async function loadThreads(client: JsonRpcClient, archived: boolean) {
  const params: ThreadListParams = {
    limit: 30,
    sortKey: "updated_at",
    sortDirection: "desc",
    archived,
  };
  const response = await client.request<ThreadListResponse>("thread/list", params);

  return dedupeThreadsById(response.data);
}

function dedupeThreadsById(threads: Thread[]) {
  const latestById = new Map<string, Thread>();

  for (const thread of threads) {
    const existing = latestById.get(thread.id);
    const threadTimestamp = thread.updatedAt || thread.createdAt || 0;
    const existingTimestamp = existing ? existing.updatedAt || existing.createdAt || 0 : -1;

    // app-server 扫描状态库和历史 JSONL 时可能返回同一 thread.id 的多个阶段快照。
    if (!existing || threadTimestamp > existingTimestamp) {
      latestById.set(thread.id, thread);
    }
  }

  return [...latestById.values()].sort((first, second) => {
    const firstTimestamp = first.updatedAt || first.createdAt || 0;
    const secondTimestamp = second.updatedAt || second.createdAt || 0;
    return secondTimestamp - firstTimestamp;
  });
}

export async function loadModels(client: JsonRpcClient) {
  const params: ModelListParams = {
    limit: 50,
    includeHidden: false,
  };
  const response = await client.request<ModelListResponse>("model/list", params);

  return response.data;
}

export async function loadAccountRateLimits(client: JsonRpcClient) {
  return client.request<GetAccountRateLimitsResponse>("account/rateLimits/read", undefined);
}

export async function loadPermissionProfiles(client: JsonRpcClient, cwd: string | null) {
  const params: PermissionProfileListParams = {
    cwd,
    limit: 50,
  };
  const response = await client.request<PermissionProfileListResponse>("permissionProfile/list", params);

  return response.data;
}

export async function updateThreadSettings(client: JsonRpcClient, params: ThreadSettingsUpdateParams) {
  return client.request<ThreadSettingsUpdateResponse>("thread/settings/update", params);
}

export async function loadSkills(client: JsonRpcClient, cwd: string | null) {
  if (!cwd) {
    return [];
  }

  const params: SkillsListParams = {
    cwds: [cwd],
    forceReload: false,
  };
  const response = await client.request<SkillsListResponse>("skills/list", params);

  return response.data.flatMap((entry) => entry.skills).filter((skill) => skill.enabled);
}

export async function loadInstalledPlugins(client: JsonRpcClient, cwd: string | null) {
  const params: PluginInstalledParams = {
    cwds: cwd ? [cwd] : undefined,
  };
  const response = await client.request<PluginInstalledResponse>("plugin/installed", params);

  const plugins = response.marketplaces.flatMap((marketplace) => marketplace.plugins).filter((plugin) => plugin.installed && plugin.enabled);
  return dedupePlugins(plugins);
}

function dedupePlugins(plugins: PluginSummary[]) {
  const seen = new Set<string>();

  return plugins.filter((plugin) => {
    if (seen.has(plugin.id)) {
      return false;
    }

    seen.add(plugin.id);
    return true;
  });
}

export async function startReview(client: JsonRpcClient, threadId: string) {
  const params: ReviewStartParams = {
    threadId,
    delivery: "inline",
    target: { type: "uncommittedChanges" },
  };
  return client.request<ReviewStartResponse>("review/start", params);
}

export async function loadTurnPage(client: JsonRpcClient, threadId: string, cursor: string | null) {
  // 当前 app-server 已支持 turn 分页，但 items 单独分页接口还未实现，所以这里直接取 full。
  const params: ThreadTurnsListParams = {
    threadId,
    cursor,
    limit: DETAIL_TURN_PAGE_SIZE,
    sortDirection: "desc",
    itemsView: "full",
  };
  const turnsResponse = await client.request<ThreadTurnsListResponse>("thread/turns/list", params);

  return {
    turns: [...turnsResponse.data].reverse(),
    nextCursor: turnsResponse.nextCursor,
  };
}

export function getInProgressTurnId(turns: Turn[]) {
  return turns.find((turn) => turn.status === "inProgress")?.id ?? null;
}

export function buildClientUserMessageId(threadId: string, sequence: number, timestampMs = Date.now()) {
  return `mobile:${sanitizeClientIdPart(threadId)}:${timestampMs}:${sequence}`;
}

function sanitizeClientIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

export function normalizeConnection(url: string, token: string): NormalizedConnection {
  const trimmedUrl = url.trim();
  const trimmedToken = token.trim();

  if (!trimmedUrl) {
    throw new Error("请先填写 WebSocket 地址");
  }

  try {
    const parsed = new URL(trimmedUrl);
    const isRelayTarget = parsed.searchParams.has("relay_token") || parsed.port === "4501" || parsed.protocol === "wss:";

    if (isRelayTarget) {
      if (trimmedToken) {
        // relay 只能从 query 读取 token，移动端不要依赖 WebSocket 自定义 header。
        parsed.searchParams.set("relay_token", trimmedToken);
      }

      return {
        socketUrl: parsed.toString(),
      };
    }

    return {
      socketUrl: parsed.toString(),
      authToken: trimmedToken || undefined,
    };
  } catch {
    throw new Error("WebSocket 地址不合法");
  }
}

export function formatReadinessLog(result: ReadinessStatus) {
  if (result.ok) {
    return `readyz ok: ${result.status}`;
  }

  return `readyz failed: ${result.error}`;
}
