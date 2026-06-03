import type {
  PermissionProfileListResponse,
  ThreadResumeParams,
  ThreadSettingsUpdateParams,
  TurnStartParams,
  TurnSteerParams,
} from "@codex-mobile/protocol/v2";

import { buildClientUserMessageId } from "./api";

const startParams: TurnStartParams = {
  threadId: "thread-1",
  clientUserMessageId: buildClientUserMessageId("thread-1", 1),
  input: [{ type: "text", text: "你好", text_elements: [] }],
};

startParams.clientUserMessageId satisfies string | null | undefined;

const steerParams: TurnSteerParams = {
  threadId: "thread-1",
  expectedTurnId: "turn-1",
  clientUserMessageId: buildClientUserMessageId("thread-1", 2),
  input: [{ type: "text", text: "继续", text_elements: [] }],
};

steerParams.clientUserMessageId satisfies string | null | undefined;

const resumeParams: ThreadResumeParams = {
  threadId: "thread-1",
  excludeTurns: true,
  initialTurnsPage: {
    limit: 4,
    sortDirection: "desc",
    itemsView: "full",
  },
};

resumeParams.initialTurnsPage?.itemsView satisfies "notLoaded" | "full" | "summary" | null | undefined;

const settingsParams: ThreadSettingsUpdateParams = {
  threadId: "thread-1",
  model: "gpt-5",
  permissions: "full-access",
};

settingsParams.permissions satisfies string | null | undefined;

const profiles: PermissionProfileListResponse = {
  data: [{ id: "full-access", description: "全部权限" }],
  nextCursor: null,
};

profiles.data[0]?.id satisfies string | undefined;
