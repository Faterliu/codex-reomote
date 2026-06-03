import type { ApprovalsReviewer, PermissionProfileSummary, SandboxMode, SandboxPolicy, ThreadSettings } from "@codex-mobile/protocol/v2";

export type BuiltInPermissionModeId = "standard" | "auto" | "full";
export type PermissionModeId = BuiltInPermissionModeId | string;

export type PermissionModeConfig = {
  id: BuiltInPermissionModeId;
  label: string;
  description: string;
  sandbox: SandboxMode;
  approvalsReviewer: ApprovalsReviewer;
};

export const PERMISSION_MODES: PermissionModeConfig[] = [
  {
    id: "standard",
    label: "标准",
    description: "工作区写入，敏感操作由你确认",
    sandbox: "workspace-write",
    approvalsReviewer: "user",
  },
  {
    id: "auto",
    label: "自动审批",
    description: "工作区写入，由自动审查处理审批",
    sandbox: "workspace-write",
    approvalsReviewer: "auto_review",
  },
  {
    id: "full",
    label: "全部权限",
    description: "danger full access，仍保留审批策略",
    sandbox: "danger-full-access",
    approvalsReviewer: "user",
  },
];

export const DEFAULT_PERMISSION_MODE_ID: PermissionModeId = "standard";

export function isBuiltInPermissionModeId(id: PermissionModeId): id is BuiltInPermissionModeId {
  return id === "standard" || id === "auto" || id === "full";
}

export function getPermissionMode(id: PermissionModeId) {
  return PERMISSION_MODES.find((mode) => mode.id === id) ?? PERMISSION_MODES[0];
}

export function getPermissionModeLabel(id: PermissionModeId, profiles: PermissionProfileSummary[] = []) {
  const builtInMode = isBuiltInPermissionModeId(id) ? getPermissionMode(id) : null;

  if (builtInMode) {
    return builtInMode.label;
  }

  const profile = profiles.find((candidate) => candidate.id === id);
  return profile?.description || id;
}

export function getPermissionModeDescription(id: PermissionModeId, profiles: PermissionProfileSummary[] = []) {
  const builtInMode = isBuiltInPermissionModeId(id) ? getPermissionMode(id) : null;

  if (builtInMode) {
    return builtInMode.description;
  }

  const profile = profiles.find((candidate) => candidate.id === id);
  return profile?.description || "app-server 权限 profile";
}

export function permissionModeFromThreadSettings(settings: ThreadSettings): PermissionModeId {
  if (settings.activePermissionProfile?.id) {
    return settings.activePermissionProfile.id;
  }

  if (settings.sandboxPolicy.type === "dangerFullAccess") {
    return "full";
  }

  if (settings.approvalsReviewer === "auto_review") {
    return "auto";
  }

  return DEFAULT_PERMISSION_MODE_ID;
}

export function getPermissionModeSandboxPolicy(id: BuiltInPermissionModeId, cwd: string): SandboxPolicy {
  if (id === "full") {
    return { type: "dangerFullAccess" };
  }

  // turn/start 需要完整 SandboxPolicy；用当前会话 cwd 作为写入根，避免空 writableRoots 收窄到不可写。
  return {
    type: "workspaceWrite",
    writableRoots: [cwd],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}
