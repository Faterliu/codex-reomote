// 额度展示逻辑的类型化样例：只做类型/边界校验，不产生运行时副作用。
import { buildRateLimitsDisplay, mergeRateLimits } from "./rateLimitFormat";

const snapshot = {
  limitId: "codex",
  limitName: null,
  primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_800_000_000 },
  secondary: { usedPercent: 88, windowDurationMins: 10080, resetsAt: 1_800_400_000 },
  credits: { hasCredits: true, unlimited: false, balance: "12" },
  individualLimit: null,
  planType: "plus" as const,
  rateLimitReachedType: null,
};

const full = {
  rateLimits: snapshot,
  rateLimitsByLimitId: { codex: snapshot },
  rateLimitResetCredits: { availableCount: 3n },
};

const display = buildRateLimitsDisplay(full);

display?.items[0]?.primary?.remainingPercent satisfies number | undefined;
display?.items[0]?.primary?.periodLabel satisfies string | null | undefined;
display?.items[0]?.depleted satisfies boolean | undefined;

// 稀疏滚动推送：只带主窗口时应保留原有 secondary / planType。
const merged = mergeRateLimits(full, { ...snapshot, primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1_800_000_600 }, secondary: null });

merged.rateLimits.secondary?.usedPercent satisfies number | null | undefined;
const mergedSecondaryPercent: number | null | undefined = merged.rateLimits.secondary?.usedPercent;
void mergedSecondaryPercent;
merged.rateLimits.planType satisfies "free" | "go" | "plus" | "pro" | "prolite" | "team" | "self_serve_business_usage_based" | "business" | "enterprise_cbp_usage_based" | "enterprise" | "edu" | "unknown" | null;

// 首次收到推送（尚无快照）也必须能构建出展示数据。
const firstPushDisplay = buildRateLimitsDisplay(mergeRateLimits(null, snapshot));
(firstPushDisplay?.items.length ?? 0) === 0;
