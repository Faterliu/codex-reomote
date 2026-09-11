import type { PlanType } from "@codex-mobile/protocol";
import type { GetAccountRateLimitsResponse, RateLimitSnapshot, RateLimitWindow } from "@codex-mobile/protocol/v2";

export type RateLimitBucket = {
  limitId: string | null;
  limitName: string | null;
  planType: PlanType | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  creditsBalance: string | null;
  unlimited: boolean;
};

export type RateLimitWindowText = {
  periodLabel: string | null;
  remainingPercent: number;
  resetLabel: string | null;
};

export type RateLimitDisplayItem = {
  key: string;
  title: string;
  primary: RateLimitWindowText | null;
  secondary: RateLimitWindowText | null;
  creditsLabel: string | null;
  unlimited: boolean;
  depleted: boolean;
};

export type RateLimitsDisplay = {
  items: RateLimitDisplayItem[];
  planLabel: string | null;
  resetCreditsLabel: string | null;
};

const PLAN_LABELS: Record<PlanType, string> = {
  free: "Free",
  go: "Go",
  plus: "Plus",
  pro: "Pro",
  prolite: "Pro Lite",
  team: "Team",
  self_serve_business_usage_based: "Business（按量）",
  business: "Business",
  enterprise_cbp_usage_based: "Enterprise（按量）",
  enterprise: "Enterprise",
  edu: "Edu",
  unknown: "未知套餐",
};

// rateLimitsByLimitId 是稀疏的滚动快照：某次推送可能只带部分字段，缺失字段沿用上一份快照。
export function mergeRateLimits(
  current: GetAccountRateLimitsResponse | null,
  snapshot: RateLimitSnapshot,
): GetAccountRateLimitsResponse {
  const key = snapshot.limitId ?? null;
  const existing = findSnapshot(current, key) ?? (current ? current.rateLimits : null);
  const merged = mergeSnapshot(existing, snapshot);
  const byLimitId = { ...(current?.rateLimitsByLimitId ?? {}) };

  if (key) {
    byLimitId[key] = merged;
  }

  return {
    // rateLimits 是向后兼容的单桶视图：只有推的是同一个桶时才跟着更新。
    rateLimits: key && current && current.rateLimits.limitId !== key ? current.rateLimits : merged,
    rateLimitsByLimitId: Object.keys(byLimitId).length ? byLimitId : null,
    rateLimitResetCredits: current?.rateLimitResetCredits ?? null,
  };
}

export function buildRateLimitsDisplay(rateLimits: GetAccountRateLimitsResponse | null): RateLimitsDisplay | null {
  if (!rateLimits) {
    return null;
  }

  const buckets = collectBuckets(rateLimits);
  const planType = buckets.find((bucket) => bucket.planType)?.planType ?? null;
  const resetCredits = formatResetCredits(rateLimits.rateLimitResetCredits?.availableCount);

  return {
    items: buckets.map(toDisplayItem),
    planLabel: planType ? PLAN_LABELS[planType] ?? String(planType) : null,
    resetCreditsLabel: resetCredits,
  };
}

function collectBuckets(rateLimits: GetAccountRateLimitsResponse): RateLimitBucket[] {
  const byLimitId = rateLimits.rateLimitsByLimitId ?? {};
  const buckets: RateLimitBucket[] = [];

  const codexBucket = byLimitId.codex;

  if (codexBucket) {
    buckets.push(toBucket(codexBucket));
  } else if (rateLimits.rateLimits.primary || rateLimits.rateLimits.secondary || rateLimits.rateLimits.credits) {
    buckets.push(toBucket(rateLimits.rateLimits));
  }

  for (const [limitId, snapshot] of Object.entries(byLimitId)) {
    if (!snapshot || limitId === "codex") {
      continue;
    }

    buckets.push(toBucket(snapshot, limitId));
  }

  return buckets;
}

function toBucket(snapshot: RateLimitSnapshot, fallbackLimitId?: string): RateLimitBucket {
  return {
    limitId: snapshot.limitId ?? fallbackLimitId ?? null,
    limitName: snapshot.limitName,
    planType: snapshot.planType,
    primary: snapshot.primary,
    secondary: snapshot.secondary,
    creditsBalance: snapshot.credits?.balance ?? null,
    unlimited: snapshot.credits?.unlimited ?? false,
  };
}

function toDisplayItem(bucket: RateLimitBucket, index: number): RateLimitDisplayItem {
  const primary = toWindowText(bucket.primary);
  const secondary = toWindowText(bucket.secondary);

  return {
    key: bucket.limitId ?? `limit-${index}`,
    title: formatBucketTitle(bucket),
    primary,
    secondary,
    creditsLabel: formatCredits(bucket),
    unlimited: bucket.unlimited,
    depleted: Boolean(primary && primary.remainingPercent <= 0) || Boolean(secondary && secondary.remainingPercent <= 0),
  };
}

function formatBucketTitle(bucket: RateLimitBucket) {
  if (bucket.limitName?.trim()) {
    return bucket.limitName.trim();
  }

  if (!bucket.limitId || bucket.limitId === "codex") {
    return "Codex 额度";
  }

  return bucket.limitId;
}

function formatCredits(bucket: RateLimitBucket) {
  if (bucket.unlimited) {
    return "额度不限量";
  }

  // balance 为 "0" / 空时当无余额处理，避免只显示「无 credits」这种噪音。
  const balance = bucket.creditsBalance?.trim();

  if (!balance || balance === "0") {
    return null;
  }

  return `剩余 credits ${balance}`;
}

function toWindowText(window: RateLimitWindow | null): RateLimitWindowText | null {
  if (!window) {
    return null;
  }

  return {
    periodLabel: formatPeriodLabel(window.windowDurationMins),
    remainingPercent: clampPercent(100 - window.usedPercent),
    resetLabel: formatResetLabel(window.resetsAt),
  };
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function formatPeriodLabel(minutes: number | null) {
  if (!minutes || minutes <= 0) {
    return null;
  }

  if (minutes % 1440 === 0) {
    return `${minutes / 1440} 天`;
  }

  if (minutes % 60 === 0) {
    return `${minutes / 60} 小时`;
  }

  return `${minutes} 分钟`;
}

function formatResetLabel(resetsAt: number | null) {
  if (!resetsAt) {
    return null;
  }

  // resetsAt 是 unix 秒；先按秒解析，异常时再按毫秒兜底。
  const millis = resetsAt < 1e11 ? resetsAt * 1000 : resetsAt;
  const date = new Date(millis);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60000);

  if (diffMinutes <= 0) {
    return "即将重置";
  }

  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟后重置`;
  }

  if (diffMinutes < 1440) {
    return `${Math.floor(diffMinutes / 60)} 小时后 ${clock} 重置`;
  }

  return `${date.getMonth() + 1}月${date.getDate()}日 ${clock} 重置`;
}

function formatResetCredits(availableCount: unknown) {
  if (availableCount === null || availableCount === undefined) {
    return null;
  }

  const text = String(availableCount);

  return text === "0" ? null : `重置次数 ${text}`;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function findSnapshot(rateLimits: GetAccountRateLimitsResponse | null, limitId: string | null) {
  if (!limitId) {
    return rateLimits?.rateLimits ?? null;
  }

  return rateLimits?.rateLimitsByLimitId?.[limitId] ?? null;
}

function mergeSnapshot(current: RateLimitSnapshot | null | undefined, update: RateLimitSnapshot): RateLimitSnapshot {
  if (!current) {
    return update;
  }

  return {
    limitId: update.limitId ?? current.limitId,
    limitName: update.limitName ?? current.limitName,
    primary: update.primary ?? current.primary,
    secondary: update.secondary ?? current.secondary,
    credits: update.credits ?? current.credits,
    individualLimit: update.individualLimit ?? current.individualLimit,
    planType: update.planType ?? current.planType,
    rateLimitReachedType: update.rateLimitReachedType ?? current.rateLimitReachedType,
  };
}
