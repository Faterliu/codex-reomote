import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

import type { ServerNotification } from "@codex-mobile/protocol";
import type {
  GetAccountRateLimitsResponse,
  Thread,
  ThreadReadResponse,
  ThreadStartParams,
  ThreadStartResponse,
  ToolRequestUserInputResponse,
} from "@codex-mobile/protocol/v2";

import { JsonRpcClient } from "@/lib/jsonRpcClient";
import { mergeRateLimits } from "@/lib/rateLimitFormat";
import { getSupportedReasoningEfforts } from "@/lib/reasoningEffort";
import { flattenTurns, timelineEntryFromCommandApproval, type TimelineEntry } from "@/lib/threadFormat";
import type { ConnectionState, JsonRpcIncoming, PendingApproval, PendingUserInputRequest, ReadinessStatus } from "@/types/codex";
import type { ComposerImageAttachment, ComposerMention } from "@/types/composer";
import {
  DEFAULT_PERMISSION_MODE_ID,
  getPermissionMode,
  getPermissionModeSandboxPolicy,
  isBuiltInPermissionModeId,
  permissionModeFromThreadSettings,
  type PermissionModeId,
} from "@/types/permissionMode";

import {
  archiveThread,
  buildClientUserMessageId,
  ensureThreadResumed,
  formatReadinessLog,
  getInProgressTurnId,
  loadInstalledPlugins,
  loadAccountRateLimits,
  loadModels,
  loadPermissionProfiles,
  loadSkills,
  loadThreads,
  loadTurnPage,
  normalizeConnection,
  resumeThreadWithInitialTurnPage,
  setThreadName,
  startReview,
  startTurn,
  steerTurn,
  updateThreadSettings,
  unarchiveThread,
} from "./codex-app-server/api";
import { buildPendingMessageBody, buildTurnInput } from "./codex-app-server/composer";
import { compactRpcError, getErrorMessage } from "./codex-app-server/errorFormat";
import { applyLocalImageCache, downloadHostFile, hydrateLocalImageAttachments, uploadComposerImages } from "./codex-app-server/imageTransfer";
import { handleNotification } from "./codex-app-server/notifications";
import {
  clearDeltaTimer,
  countUserText,
  isSameTimeline,
  mergeTimelineSnapshot,
  mergePendingEntries,
  reconcilePendingEntries,
  resolveOlderTurnsCursor,
  uniqueCwds,
} from "./codex-app-server/timelineState";
import type { DeltaBuffer, LiveEvent, NormalizedConnection, PendingEntry, PickerData } from "./codex-app-server/types";

const DETAIL_REFRESH_INTERVAL_MS = 3000;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10000;
const MAX_LOAD_MORE_PAGE_ATTEMPTS = 3;

export type CodexAppServerState = ReturnType<typeof useCodexAppServer>;

export function useCodexAppServer() {
  const [state, setState] = useState<ConnectionState>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [archivedThreads, setArchivedThreads] = useState<Thread[]>([]);
  const [showArchivedThreads, setShowArchivedThreads] = useState(false);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [userInputRequest, setUserInputRequest] = useState<PendingUserInputRequest | null>(null);
  const [readiness, setReadiness] = useState<ReadinessStatus | null>(null);
  const [isOpeningThread, setIsOpeningThread] = useState(false);
  const [isRefreshingThreads, setIsRefreshingThreads] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshingThread, setIsRefreshingThread] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [isInterruptingTurn, setIsInterruptingTurn] = useState(false);
  const [isLoadingPickerData, setIsLoadingPickerData] = useState(false);
  const [olderTurnsCursor, setOlderTurnsCursor] = useState<string | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<string | null>(null);
  const [selectedPermissionModeId, setSelectedPermissionModeId] = useState<PermissionModeId>(DEFAULT_PERMISSION_MODE_ID);
  const [rateLimits, setRateLimits] = useState<GetAccountRateLimitsResponse | null>(null);
  const [pickerData, setPickerData] = useState<PickerData>({
    models: [],
    permissionProfiles: [],
    skills: [],
    plugins: [],
  });
  const [pendingEntries, setPendingEntries] = useState<PendingEntry[]>([]);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [imageCacheVersion, setImageCacheVersion] = useState(0);

  const clientRef = useRef<JsonRpcClient | null>(null);
  const pendingCounterRef = useRef(1);
  const lastConnectionRef = useRef<NormalizedConnection | null>(null);
  const manualDisconnectRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const selectedThreadIdRef = useRef<string | null>(null);
  const isLoadingMoreRef = useRef(false);
  const olderTurnsCursorRef = useRef<string | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const timelineRef = useRef<TimelineEntry[]>([]);
  const deltaBufferRef = useRef<DeltaBuffer>({
    timer: null,
    chunks: new Map(),
  });
  const localImageCacheRef = useRef(new Map<string, string>());

  const client = useMemo(() => {
    const instance = new JsonRpcClient({
      onStateChange: (nextState) => {
        setState(nextState);
        if (nextState === "closed" || nextState === "error" || nextState === "idle") {
          setActiveTurnId(null);
          setApproval(null);
          setUserInputRequest(null);
        }
      },
      onNotification: (message) => {
        syncThreadSettingsNotification(message);
        syncRateLimitNotification(message);
        handleNotification(message, {
          setThreads,
          setSelectedThread,
          setTimeline,
          setEvents,
          selectedThreadIdRef,
          deltaBufferRef,
          setActiveTurnId,
          setApproval,
          setUserInputRequest,
        });
      },
      onApproval: (request) => {
        setApproval(request);
        if (request.method === "item/commandExecution/requestApproval" && request.params.threadId === selectedThreadIdRef.current) {
          setTimeline((current) => upsertTimelineEntry(current, timelineEntryFromCommandApproval(request.params)));
        }
      },
      onUserInputRequest: setUserInputRequest,
      onLog: (line) => {
        setLogs((current) => [line, ...current].slice(0, 30));
        if (isErrorLog(line)) {
          setRecentError(line);
        }
      },
    });
    clientRef.current = instance;
    return instance;
  }, []);

  const syncThreadSettingsNotification = (message: JsonRpcIncoming) => {
    if (!("method" in message) || message.method !== "thread/settings/updated") {
      return;
    }

    const notification = message as Extract<ServerNotification, { method: "thread/settings/updated" }>;
    if (notification.params.threadId !== selectedThreadIdRef.current) {
      return;
    }

    setSelectedModelId(notification.params.threadSettings.model);
    setSelectedReasoningEffort(notification.params.threadSettings.effort);
    setSelectedPermissionModeId(permissionModeFromThreadSettings(notification.params.threadSettings));
  };

  const syncRateLimitNotification = (message: JsonRpcIncoming) => {
    if (!("method" in message) || message.method !== "account/rateLimits/updated") {
      return;
    }

    const notification = message as Extract<ServerNotification, { method: "account/rateLimits/updated" }>;
    // 滚动推送是稀疏快照，只合并有值的字段，缺失字段不能清掉已有数据。
    setRateLimits((current) => mergeRateLimits(current, notification.params.rateLimits));
  };

  const visibleTimeline = useMemo(
    () => applyLocalImageCache(mergePendingEntries(timeline, pendingEntries, selectedThread?.id ?? null), localImageCacheRef.current),
    [timeline, pendingEntries, selectedThread?.id, imageCacheVersion],
  );
  const recentCwds = useMemo(() => uniqueCwds(threads), [threads]);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThread?.id ?? null;
  }, [selectedThread?.id]);

  useEffect(() => {
    olderTurnsCursorRef.current = olderTurnsCursor;
  }, [olderTurnsCursor]);

  useEffect(() => {
    activeTurnIdRef.current = activeTurnId;
  }, [activeTurnId]);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  useEffect(() => {
    if (!selectedThread || isOpeningThread || state !== "connected") {
      return;
    }

    const timer = setInterval(() => {
      void refreshSelectedThread({ silent: true });
    }, DETAIL_REFRESH_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [selectedThread?.id, isOpeningThread, state]);

  useEffect(() => {
    if (state !== "connected") {
      return;
    }

    clearReconnectTimer(reconnectTimerRef);
    reconnectAttemptRef.current = 0;
    setRecentError(null);
    void refreshThreads();
    if (selectedThread) {
      void recoverSelectedThreadSubscription(selectedThread);
    }
  }, [state]);

  useEffect(() => {
    if (state !== "connected") {
      return;
    }

    void refreshPickerData();
  }, [selectedThread?.id, state]);

  useEffect(() => {
    if (state !== "connected" || !timeline.length) {
      return;
    }

    let cancelled = false;
    void hydrateLocalImageAttachments(client, timeline, localImageCacheRef.current, () => {
      if (!cancelled) {
        setImageCacheVersion((current) => current + 1);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [client, state, timeline]);

  useEffect(() => {
    if (state !== "closed" && state !== "error") {
      return;
    }

    if (manualDisconnectRef.current || !lastConnectionRef.current) {
      return;
    }

    scheduleReconnect();
  }, [state]);

  useEffect(
    () => () => {
      clearReconnectTimer(reconnectTimerRef);
      clearDeltaTimer(deltaBufferRef);
    },
    [],
  );

  const connect = (url: string, token = "") => {
    setReadiness(null);
    setRecentError(null);
    clearReconnectTimer(reconnectTimerRef);
    manualDisconnectRef.current = false;
    reconnectAttemptRef.current = 0;

    try {
      const target = normalizeConnection(url, token);
      lastConnectionRef.current = target;
      client.connect(target.socketUrl, target.authToken);
    } catch (error) {
      const message = getErrorMessage(error);
      lastConnectionRef.current = null;
      setRecentError(message);
      setLogs((current) => [`connect failed: ${message}`, ...current].slice(0, 30));
    }
  };

  const disconnect = () => {
    manualDisconnectRef.current = true;
    clearReconnectTimer(reconnectTimerRef);
    client.disconnect();
    setState("closed");
  };

  const scheduleReconnect = () => {
    const target = lastConnectionRef.current;

    if (!target) {
      return;
    }

    if (reconnectTimerRef.current) {
      setState("reconnecting");
      return;
    }

    const attempt = reconnectAttemptRef.current + 1;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1), RECONNECT_MAX_DELAY_MS);
    reconnectAttemptRef.current = attempt;

    setState("reconnecting");
    setLogs((current) => [`连接断开，${Math.round(delay / 1000)} 秒后自动重连（第 ${attempt} 次）`, ...current].slice(0, 30));

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;

      if (manualDisconnectRef.current || !lastConnectionRef.current) {
        return;
      }

      // 自动重连复用上一次规范化后的地址，避免 SecureStore 或输入框里的旧 query 干扰。
      client.connect(target.socketUrl, target.authToken);
    }, delay);
  };

  const closeThread = () => {
    selectedThreadIdRef.current = null;
    clearDeltaTimer(deltaBufferRef);
    deltaBufferRef.current.chunks.clear();
    setSelectedThread(null);
    setTimeline([]);
    localImageCacheRef.current.clear();
    setImageCacheVersion((current) => current + 1);
    setIsOpeningThread(false);
    setIsLoadingMore(false);
    setIsRefreshingThread(false);
    setIsInterruptingTurn(false);
    setOlderTurnsCursor(null);
    setActiveTurnId(null);
  };

  const refreshThreads = async (options: { archived?: boolean } = {}) => {
    if (isRefreshingThreads) {
      return;
    }

    setIsRefreshingThreads(true);
    try {
      const archived = options.archived ?? showArchivedThreads;
      const data = await loadThreads(client, archived);
      if (archived) {
        setArchivedThreads(data);
      } else {
        setThreads(data);
      }
    } catch (error) {
      const message = compactRpcError(error);
      setRecentError(`thread refresh failed: ${message}`);
      setLogs((current) => [`thread refresh failed: ${message}`, ...current].slice(0, 30));
    } finally {
      setIsRefreshingThreads(false);
    }
  };

  const toggleArchivedThreads = async () => {
    const next = !showArchivedThreads;
    setShowArchivedThreads(next);
    await refreshThreads({ archived: next });
  };

  // 打开会话后统一落地 timeline 状态，resume 失败走兜底拉取时复用同一套逻辑。
  const applyOpenedThreadPage = (threadId: string, page: Awaited<ReturnType<typeof loadTurnPage>>) => {
    if (selectedThreadIdRef.current !== threadId) {
      return;
    }

    const pageTimeline = flattenTurns(page.turns);
    setActiveTurnId(getInProgressTurnId(page.turns));
    setTimeline(pageTimeline);
    setOlderTurnsCursor(page.nextCursor);
    setPendingEntries((current) => reconcilePendingEntries(current, pageTimeline, threadId));
  };

  const openThread = async (thread: Thread) => {
    selectedThreadIdRef.current = thread.id;
    setSelectedThread(thread);
    setTimeline([]);
    setIsOpeningThread(true);
    setOlderTurnsCursor(null);
    setActiveTurnId(null);

    try {
      // 打开会话必须拿到该 thread 自己的 model / effort。resume 和 turns/list 的往返次数相同，
      // 所以这里始终走 resume，避免沿用上一个会话的设置。
      const resumed = await resumeThreadWithInitialTurnPage(client, thread, {
        force: thread.status.type === "active",
        requireThreadSettings: true,
      });
      if (selectedThreadIdRef.current !== thread.id) {
        return;
      }

      const resumedThread = resumed.thread;
      // 无条件覆盖：resume 返回的就是该 thread 的权威设置，不做「保留当前值」的兜底。
      // 拿不到时清空，turn/start 不传这两个字段，由 app-server 按该 thread 自身设置执行。
      setSelectedModelId(resumed.model || null);
      setSelectedReasoningEffort(resumed.reasoningEffort ?? null);
      setSelectedThread(resumedThread);

      applyOpenedThreadPage(thread.id, resumed.initialTurnsPage ?? (await loadTurnPage(client, resumedThread.id, null)));
    } catch (error) {
      // 读不到权威设置时必须清空，绝不能把上一个会话的模型 / 思考程度发给当前会话。
      setSelectedModelId(null);
      setSelectedReasoningEffort(null);

      const message = compactRpcError(error);
      setRecentError(`open thread failed: ${message}`);
      setLogs((current) => [`open thread failed: ${message}`, ...current].slice(0, 30));

      try {
        applyOpenedThreadPage(thread.id, await loadTurnPage(client, thread.id, null));
      } catch {
        // 兜底拉取也失败时保留空 timeline，错误已记录在 recentError。
      }
    } finally {
      if (selectedThreadIdRef.current === thread.id) {
        setIsOpeningThread(false);
      }
    }
  };

  const recoverSelectedThreadSubscription = async (thread: Thread) => {
    const threadId = thread.id;

    try {
      // 重连后强制 resume 当前 thread，触发 app-server 重新 attach listener 并重放未决审批 request。
      const resumed = await resumeThreadWithInitialTurnPage(client, thread, { force: true });
      if (selectedThreadIdRef.current !== threadId) {
        return;
      }

      const resumedThread = resumed.thread;
      // 重连后同样以服务端为准，覆盖模型与思考程度，避免电脑端改过之后手机端不跟。
      setSelectedModelId(resumed.model || null);
      setSelectedReasoningEffort(resumed.reasoningEffort ?? null);
      setSelectedThread(resumedThread);
      setThreads((current) => current.map((candidate) => (candidate.id === resumedThread.id ? { ...candidate, ...resumedThread } : candidate)));

      const page = resumed.initialTurnsPage ?? (await loadTurnPage(client, resumedThread.id, null));
      if (selectedThreadIdRef.current !== threadId) {
        return;
      }

      const nextTimeline = flattenTurns(page.turns);
      const nextActiveTurnId = getInProgressTurnId(page.turns);
      setActiveTurnId(nextActiveTurnId);
      setOlderTurnsCursor(resolveOlderTurnsCursor(olderTurnsCursorRef.current, page.nextCursor, timelineRef.current, nextTimeline));
      setTimeline((current) => {
        const mergedTimeline = mergeTimelineSnapshot(current, nextTimeline, { preserveTurnIds: [nextActiveTurnId] });
        return isSameTimeline(current, mergedTimeline) ? current : mergedTimeline;
      });
      setPendingEntries((current) => reconcilePendingEntries(current, nextTimeline, resumedThread.id));
    } catch (error) {
      const message = compactRpcError(error);
      setRecentError(`resume recovery failed: ${message}`);
      setLogs((current) => [`resume recovery failed: ${message}`, ...current].slice(0, 30));
      await refreshSelectedThread({ silent: true });
    }
  };

  const loadOlderMessages = async () => {
    if (!selectedThread || !olderTurnsCursor || isLoadingMoreRef.current) {
      return;
    }

    const threadId = selectedThread.id;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const page = await loadOlderVisibleTurnPage(threadId, olderTurnsCursor);
      if (selectedThreadIdRef.current !== threadId) {
        return;
      }
      const pageTimeline = flattenTurns(page.turns);
      setTimeline((current) => [...pageTimeline, ...current]);
      setOlderTurnsCursor(page.nextCursor);
    } finally {
      if (selectedThreadIdRef.current === threadId) {
        setIsLoadingMore(false);
      }
      isLoadingMoreRef.current = false;
    }
  };

  const loadOlderVisibleTurnPage = async (threadId: string, cursor: string) => {
    let nextCursor: string | null = cursor;
    const turns: Awaited<ReturnType<typeof loadTurnPage>>["turns"] = [];

    for (let attempt = 0; attempt < MAX_LOAD_MORE_PAGE_ATTEMPTS && nextCursor; attempt += 1) {
      const page = await loadTurnPage(client, threadId, nextCursor);
      turns.push(...page.turns);
      nextCursor = page.nextCursor;

      // app-server 按 turn 分页；有些历史 turn 展示后可能没有可见消息。一次点击尽量翻到有内容的页。
      if (flattenTurns(turns).length > 0 || !nextCursor) {
        break;
      }
    }

    return { turns, nextCursor };
  };

  const sendMessage = async (text: string, mentions: ComposerMention[] = [], images: ComposerImageAttachment[] = []) => {
    const trimmed = text.trim();

    if (!selectedThread || (!trimmed && !images.length)) {
      return;
    }

    const sourceThread = selectedThread;
    const clientUserMessageId = buildClientUserMessageId(sourceThread.id, nextPendingSequence());
    const pendingBody = buildPendingMessageBody(trimmed, images);
    const pendingId = addPendingMessage(sourceThread.id, pendingBody, countUserText(timeline, trimmed), images, trimmed, clientUserMessageId);

    try {
      const resumedThread = await sendMessageToThread(sourceThread, trimmed, mentions, images, clientUserMessageId);
      markPendingMessageSent(pendingId);
      if (selectedThreadIdRef.current === sourceThread.id) {
        setSelectedThread(resumedThread);
      }
    } catch (error) {
      const message = compactRpcError(error);
      setRecentError(`send failed: ${message}`);
      setLogs((current) => [`send failed: ${message}`, ...current].slice(0, 30));
      markPendingMessageFailed(pendingId);
    }
  };

  const sendMessageToThread = async (
    thread: Thread,
    text: string,
    mentions: ComposerMention[] = [],
    images: ComposerImageAttachment[] = [],
    clientUserMessageId?: string,
  ) => {
    const resumedThread = await ensureThreadResumed(client, thread);
    const uploadedImagePaths = await uploadComposerImages(client, resumedThread.cwd, images);
    const input = buildTurnInput(text, mentions, uploadedImagePaths);

    if (activeTurnId && selectedThread?.status.type === "active" && selectedThreadIdRef.current === resumedThread.id) {
      await steerTurn(client, resumedThread.id, activeTurnId, input, clientUserMessageId);
      return resumedThread;
    }

    await startTurn(client, resumedThread.id, input, {
      clientUserMessageId,
      cwd: resumedThread.cwd,
      model: selectedModelId,
      effort: selectedReasoningEffort,
      permissionMode: selectedPermissionModeId,
    });
    return resumedThread;
  };

  const runShellCommand = async (command: string) => {
    const trimmed = command.trim();

    if (!selectedThread || !trimmed) {
      return;
    }

    try {
      const resumedThread = await ensureThreadResumed(client, selectedThread);
      if (selectedThreadIdRef.current === selectedThread.id) {
        setSelectedThread(resumedThread);
      }
      await client.request("thread/shellCommand", {
        threadId: resumedThread.id,
        command: trimmed,
      });
    } catch (error) {
      const message = compactRpcError(error);
      setRecentError(`shell command failed: ${message}`);
      setLogs((current) => [`shell command failed: ${message}`, ...current].slice(0, 30));
    }
  };

  const downloadFileFromHost = async (hostPath: string) => {
    try {
      const result = await downloadHostFile(client, hostPath);
      setLogs((current) => [`downloaded ${hostPath} -> ${result.localUri}`, ...current].slice(0, 30));
      return result;
    } catch (error) {
      const message = compactRpcError(error);
      setRecentError(`download failed: ${message}`);
      setLogs((current) => [`download failed: ${message}`, ...current].slice(0, 30));
      throw error;
    }
  };

  const nextPendingSequence = () => {
    const sequence = pendingCounterRef.current;
    pendingCounterRef.current += 1;
    return sequence;
  };

  const addPendingMessage = (
    threadId: string,
    text: string,
    baselineCount: number,
    images: ComposerImageAttachment[] = [],
    sourceText = text,
    clientId = buildClientUserMessageId(threadId, nextPendingSequence()),
  ) => {
    const pendingId = `pending:${clientId}`;

    setPendingEntries((current) => [
      ...current,
      {
        id: pendingId,
        role: "user",
        title: "You",
        body: text,
        attachments: images.map((image) => ({
          type: "image",
          uri: image.uri,
          label: "图片",
        })),
        timestampMs: Date.now(),
        threadId,
        sourceText,
        baselineCount,
        clientId,
        pending: true,
      },
    ]);

    return pendingId;
  };

  const markPendingMessageSent = (pendingId: string) => {
    // turn/steer 成功后 app-server 不一定回显 user item；不能只靠服务端回显来结束“发送中”状态。
    setPendingEntries((current) => current.map((entry) => (entry.id === pendingId ? { ...entry, pending: false } : entry)));
  };

  const markPendingMessageFailed = (pendingId: string) => {
    setPendingEntries((current) =>
      current.map((entry) => (entry.id === pendingId ? { ...entry, pending: false, failed: true, title: "发送失败" } : entry)),
    );
  };

  const createThread = async (cwd: string | null, message: string, mentions: ComposerMention[] = [], images: ComposerImageAttachment[] = []) => {
    const trimmedCwd = cwd?.trim() || null;
    const trimmedMessage = message.trim();

    if ((!trimmedMessage && !images.length) || isCreatingThread) {
      return;
    }

    setIsCreatingThread(true);
    setRecentError(null);
    let pendingId: string | null = null;

    try {
      const permissionMode = isBuiltInPermissionModeId(selectedPermissionModeId) ? getPermissionMode(selectedPermissionModeId) : null;
      const params: ThreadStartParams = {
        cwd: trimmedCwd,
        model: selectedModelId ?? undefined,
        approvalsReviewer: permissionMode?.approvalsReviewer,
        permissions: permissionMode ? undefined : selectedPermissionModeId,
        sandbox: permissionMode?.sandbox,
        experimentalRawEvents: false,
      };
      const result = await client.request<ThreadStartResponse>("thread/start", params);

      setThreads((current) => [result.thread, ...current.filter((thread) => thread.id !== result.thread.id)]);
      setSelectedThread(result.thread);
      setTimeline([]);
      setOlderTurnsCursor(null);
      const clientUserMessageId = buildClientUserMessageId(result.thread.id, nextPendingSequence());
      pendingId = addPendingMessage(result.thread.id, buildPendingMessageBody(trimmedMessage, images), 0, images, trimmedMessage, clientUserMessageId);

      await sendMessageToThread(result.thread, trimmedMessage, mentions, images, clientUserMessageId);
      markPendingMessageSent(pendingId);
      await openThread(result.thread);
    } catch (error) {
      const messageText = compactRpcError(error);
      setRecentError(`create failed: ${messageText}`);
      setLogs((current) => [`create failed: ${messageText}`, ...current].slice(0, 30));
      if (pendingId) {
        markPendingMessageFailed(pendingId);
      }
    } finally {
      setIsCreatingThread(false);
    }
  };

  const refreshPickerData = async () => {
    if (state !== "connected" || isLoadingPickerData) {
      return;
    }

    setIsLoadingPickerData(true);

    try {
      const cwd = selectedThread?.cwd ?? recentCwds[0] ?? null;
      const [modelsResult, permissionProfilesResult, skillsResult, pluginsResult, rateLimitsResult] = await Promise.allSettled([
        loadModels(client),
        loadPermissionProfiles(client, cwd),
        loadSkills(client, cwd),
        loadInstalledPlugins(client, cwd),
        loadAccountRateLimits(client),
      ]);

      if (modelsResult.status === "rejected") {
        const message = compactRpcError(modelsResult.reason);
        setRecentError(`model list failed: ${message}`);
        setLogs((current) => [`model list failed: ${message}`, ...current].slice(0, 30));
        return;
      }

      const permissionProfiles = permissionProfilesResult.status === "fulfilled" ? permissionProfilesResult.value : [];
      const skills = skillsResult.status === "fulfilled" ? skillsResult.value : [];
      const plugins = pluginsResult.status === "fulfilled" ? pluginsResult.value : [];
      const optionalLogs = [
        permissionProfilesResult.status === "rejected" ? `permission profiles unavailable: ${compactRpcError(permissionProfilesResult.reason)}` : null,
        skillsResult.status === "rejected" ? `skills unavailable: ${compactRpcError(skillsResult.reason)}` : null,
        pluginsResult.status === "rejected" ? `plugins unavailable: ${compactRpcError(pluginsResult.reason)}` : null,
        rateLimitsResult.status === "rejected" ? `rate limits unavailable: ${compactRpcError(rateLimitsResult.reason)}` : null,
      ].filter((line): line is string => Boolean(line));

      setPickerData({ models: modelsResult.value, permissionProfiles, skills, plugins });
      // 额度读取失败时保留上一次快照，避免面板闪成「暂无额度数据」。
      if (rateLimitsResult.status === "fulfilled") {
        setRateLimits(rateLimitsResult.value);
      }

      // 默认模型必须先算出来，才能取到它自己的 defaultReasoningEffort（selectedModelId 此时可能还是 null）。
      const defaultModel = modelsResult.value.find((model) => model.isDefault) ?? modelsResult.value[0] ?? null;

      if (!selectedThreadIdRef.current) {
        // 只在没有选中会话（新建会话草稿）时用应用默认值兜底。
        // 选中会话时模型 / 思考程度必须以该 thread 的 resume 结果为准：resume 失败会清空这两个值，
        // 若在这里填回默认值，下一次 turn/start 就会用默认模型覆盖掉服务端该会话的真实设置。
        setSelectedModelId((current) => current ?? defaultModel?.model ?? null);
        setSelectedReasoningEffort((current) => current ?? modelsResult.value.find((model) => model.model === (selectedModelId ?? defaultModel?.model))?.defaultReasoningEffort ?? null);
      }

      if (optionalLogs.length) {
        // skills/plugins 是输入框增强能力，加载失败时不影响主连接和会话功能。
        setLogs((current) => [...optionalLogs, ...current].slice(0, 30));
      }
    } finally {
      setIsLoadingPickerData(false);
    }
  };

  const renameThread = async (name: string) => {
    const trimmed = name.trim();

    if (!selectedThread || !trimmed) {
      return;
    }

    const threadId = selectedThread.id;

    try {
      await setThreadName(client, threadId, trimmed);
      setSelectedThread((current) => (current?.id === threadId ? { ...current, name: trimmed } : current));
      setThreads((current) => current.map((thread) => (thread.id === threadId ? { ...thread, name: trimmed } : thread)));
    } catch (error) {
      const message = compactRpcError(error);
      setRecentError(`rename failed: ${message}`);
      setLogs((current) => [`rename failed: ${message}`, ...current].slice(0, 30));
    }
  };

  const selectModel = (modelId: string) => {
    const nextModel = pickerData.models.find((model) => model.model === modelId) ?? null;
    // 只改用户真正点过的那个参数：新模型仍支持当前思考程度就原样保留，
    // 只有当前档位在新模型上不被支持时才回退到新模型的默认档位。
    const supportedEfforts = nextModel ? getSupportedReasoningEfforts(nextModel) : [];
    const keptEffort = supportedEfforts.find((option) => option.id === selectedReasoningEffort);
    const nextEffort = keptEffort?.id ?? nextModel?.defaultReasoningEffort ?? null;

    setSelectedModelId(modelId);
    setSelectedReasoningEffort(nextEffort);
    void updateSelectedThreadSettings({ model: modelId, effort: nextEffort }, "model settings update failed");
  };

  const selectReasoningEffort = (effort: string) => {
    setSelectedReasoningEffort(effort);
    void updateSelectedThreadSettings({ effort }, "reasoning settings update failed");
  };

  const selectPermissionMode = (modeId: PermissionModeId) => {
    setSelectedPermissionModeId(modeId);

    if (isBuiltInPermissionModeId(modeId)) {
      const mode = getPermissionMode(modeId);
      void updateSelectedThreadSettings(
        {
          approvalsReviewer: mode.approvalsReviewer,
          permissions: null,
          sandboxPolicy: selectedThread?.cwd ? getPermissionModeSandboxPolicy(mode.id, selectedThread.cwd) : undefined,
        },
        "permission settings update failed",
      );
      return;
    }

    void updateSelectedThreadSettings({ permissions: modeId }, "permission settings update failed");
  };

  const updateSelectedThreadSettings = async (
    params: Omit<Parameters<typeof updateThreadSettings>[1], "threadId">,
    logPrefix: string,
  ) => {
    if (!selectedThread || state !== "connected") {
      return;
    }

    try {
      await updateThreadSettings(client, {
        threadId: selectedThread.id,
        ...params,
      });
    } catch (error) {
      const message = compactRpcError(error);
      setRecentError(`${logPrefix}: ${message}`);
      setLogs((current) => [`${logPrefix}: ${message}`, ...current].slice(0, 30));
    }
  };

  const archiveSelectedThread = async () => {
    if (!selectedThread) {
      return;
    }

    const threadId = selectedThread.id;

    try {
      await archiveThread(client, threadId);
      setThreads((current) => current.filter((thread) => thread.id !== threadId));
      closeThread();
    } catch (error) {
      const message = compactRpcError(error);
      setRecentError(`archive failed: ${message}`);
      setLogs((current) => [`archive failed: ${message}`, ...current].slice(0, 30));
    }
  };

  const restoreThread = async (thread: Thread) => {
    try {
      const response = await unarchiveThread(client, thread.id);
      setArchivedThreads((current) => current.filter((candidate) => candidate.id !== thread.id));
      setThreads((current) => [response.thread, ...current.filter((candidate) => candidate.id !== response.thread.id)]);
    } catch (error) {
      const message = compactRpcError(error);
      setRecentError(`unarchive failed: ${message}`);
      setLogs((current) => [`unarchive failed: ${message}`, ...current].slice(0, 30));
    }
  };

  const startCurrentReview = async () => {
    if (!selectedThread || activeTurnId) {
      return;
    }

    try {
      const resumedThread = await ensureThreadResumed(client, selectedThread);
      const response = await startReview(client, resumedThread.id);
      setSelectedThread(resumedThread);
      setActiveTurnId(response.turn.id);
    } catch (error) {
      const message = compactRpcError(error);
      setRecentError(`review failed: ${message}`);
      setLogs((current) => [`review failed: ${message}`, ...current].slice(0, 30));
    }
  };

  const resolveApproval = async (decision: "accept" | "acceptForSession" | "decline" | "cancel") => {
    if (!approval) {
      return;
    }

    await client.resolveApproval(approval, decision);
    setApproval(null);
  };

  const resolveUserInputRequest = async (response: ToolRequestUserInputResponse) => {
    if (!userInputRequest) {
      return;
    }

    await client.resolveUserInputRequest(userInputRequest, response);
    setUserInputRequest(null);
  };

  const probeReadiness = async (url: string, token = "") => {
    try {
      const target = normalizeConnection(url, token);
      const result = await client.probeReadiness(target.socketUrl, target.authToken);
      setReadiness(result);
      setLogs((current) => [formatReadinessLog(result), ...current].slice(0, 30));
      if (!result.ok) {
        setRecentError(result.error);
      }
      return result;
    } catch (error) {
      const result: ReadinessStatus = {
        ok: false,
        error: compactRpcError(error),
      };
      setReadiness(result);
      setRecentError(result.error);
      setLogs((current) => [formatReadinessLog(result), ...current].slice(0, 30));
      return result;
    }
  };

  const interruptTurn = async () => {
    if (!selectedThread || !activeTurnId || isInterruptingTurn) {
      return;
    }

    setIsInterruptingTurn(true);

    try {
      await client.request("turn/interrupt", {
        threadId: selectedThread.id,
        turnId: activeTurnId,
      });
    } catch (error) {
      const message = compactRpcError(error);
      setRecentError(`interrupt failed: ${message}`);
      setLogs((current) => [`interrupt failed: ${message}`, ...current].slice(0, 30));
    } finally {
      setIsInterruptingTurn(false);
    }
  };

  const refreshSelectedThread = async (options: { silent?: boolean } = {}) => {
    if (!selectedThread) {
      return;
    }

    const threadId = selectedThread.id;

    if (!options.silent) {
      setIsRefreshingThread(true);
    }

    try {
      const threadResponse = await client.request<ThreadReadResponse>("thread/read", {
        threadId,
        includeTurns: false,
      });
      if (selectedThreadIdRef.current !== threadId) {
        return;
      }
      const page = await loadTurnPage(client, threadResponse.thread.id, null);
      if (selectedThreadIdRef.current !== threadId) {
        return;
      }
      const nextTimeline = flattenTurns(page.turns);
      const nextActiveTurnId = getInProgressTurnId(page.turns);
      setSelectedThread(threadResponse.thread);
      setActiveTurnId(nextActiveTurnId);
      setThreads((current) =>
        current.map((thread) => (thread.id === threadResponse.thread.id ? { ...thread, ...threadResponse.thread } : thread)),
      );
      setOlderTurnsCursor(resolveOlderTurnsCursor(olderTurnsCursorRef.current, page.nextCursor, timelineRef.current, nextTimeline));
      setTimeline((current) => {
        const currentActiveTurnId = activeTurnIdRef.current;
        // 静默刷新只校准历史和完成态；正在回复的 turn 继续以实时通知为准，避免 3 秒快照覆盖流式 delta。
        const preservedActiveTurnId = options.silent && currentActiveTurnId && currentActiveTurnId === nextActiveTurnId ? currentActiveTurnId : null;
        const mergedTimeline = mergeTimelineSnapshot(current, nextTimeline, { preserveTurnIds: [preservedActiveTurnId] });
        return isSameTimeline(current, mergedTimeline) ? current : mergedTimeline;
      });
      setPendingEntries((current) => reconcilePendingEntries(current, nextTimeline, threadResponse.thread.id));
    } catch (error) {
      const message = compactRpcError(error);
      setRecentError(`refresh failed: ${message}`);
      setLogs((current) => [`refresh failed: ${message}`, ...current].slice(0, 30));
    } finally {
      if (!options.silent && selectedThreadIdRef.current === threadId) {
        setIsRefreshingThread(false);
      }
    }
  };

  return {
    state,
    logs,
    recentError,
    threads,
    archivedThreads,
    displayedThreads: showArchivedThreads ? archivedThreads : threads,
    showArchivedThreads,
    recentCwds,
    selectedThread,
    timeline: visibleTimeline,
    events,
    approval,
    userInputRequest,
    readiness,
    isOpeningThread,
    isRefreshingThreads,
    isLoadingMore,
    isRefreshingThread,
    isCreatingThread,
    isInterruptingTurn,
    isLoadingPickerData,
    selectedModelId,
    selectedReasoningEffort,
    selectedPermissionModeId,
    pickerData,
    rateLimits,
    activeTurnId,
    isResponding: Boolean(activeTurnId) || selectedThread?.status.type === "active",
    statusLabel: activeTurnId ? "正在回复..." : getThreadStatusLabel(selectedThread),
    hasMoreMessages: Boolean(olderTurnsCursor),
    connect,
    disconnect,
    closeThread,
    probeReadiness,
    refreshThreads,
    toggleArchivedThreads,
    openThread,
    loadOlderMessages,
    refreshSelectedThread,
    refreshPickerData,
    createThread,
    sendMessage,
    setSelectedModelId: selectModel,
    setSelectedReasoningEffort: selectReasoningEffort,
    setSelectedPermissionModeId: selectPermissionMode,
    renameThread,
    archiveSelectedThread,
    restoreThread,
    startCurrentReview,
    runShellCommand,
    downloadFileFromHost,
    interruptTurn,
    resolveApproval,
    resolveUserInputRequest,
  };
}

function upsertTimelineEntry(current: TimelineEntry[], entry: TimelineEntry) {
  const index = current.findIndex((candidate) => candidate.id === entry.id);

  if (index === -1) {
    return [...current, entry];
  }

  return current.map((candidate, candidateIndex) =>
    candidateIndex === index
      ? {
          ...entry,
          body: entry.body || candidate.body,
          commandOutput: candidate.commandOutput || entry.commandOutput,
        }
      : candidate,
  );
}

function getThreadStatusLabel(thread: Thread | null) {
  if (!thread) {
    return null;
  }

  if (thread.status.type === "active") {
    if (thread.status.activeFlags.includes("waitingOnApproval")) {
      return "等待审批...";
    }

    if (thread.status.activeFlags.includes("waitingOnUserInput")) {
      return "等待输入...";
    }

    return "正在回复...";
  }

  if (thread.status.type === "systemError") {
    return "系统错误";
  }

  return null;
}

function isErrorLog(line: string) {
  return /error|failed|closed|403|拒绝|失败/i.test(line);
}

function clearReconnectTimer(timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>) {
  if (!timerRef.current) {
    return;
  }

  clearTimeout(timerRef.current);
  timerRef.current = null;
}
