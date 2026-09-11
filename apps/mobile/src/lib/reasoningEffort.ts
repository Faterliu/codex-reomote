import type { Model } from "@codex-mobile/protocol/v2";

export const REASONING_EFFORT_OPTIONS = [
  { id: "low", label: "轻度" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
  { id: "xhigh", label: "极高" },
  { id: "max", label: "最高" },
  { id: "ultra", label: "ultra" },
] as const;

export function getReasoningEffortLabel(effort: string | null) {
  if (!effort) {
    return null;
  }

  return REASONING_EFFORT_OPTIONS.find((option) => option.id === effort)?.label ?? effort;
}

export function getSupportedReasoningEfforts(model: Model | null) {
  if (!model) {
    return [];
  }

  const supported = new Set(model.supportedReasoningEfforts.map((option) => option.reasoningEffort));

  // 使用 Codex 界面的固定顺序和命名，同时只显示当前模型真正支持的档位。
  return REASONING_EFFORT_OPTIONS.filter((option) => supported.has(option.id));
}
