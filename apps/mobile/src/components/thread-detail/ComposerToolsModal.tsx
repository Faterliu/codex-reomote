import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";

import type { GetAccountRateLimitsResponse, Model, PermissionProfileSummary, PluginSummary, SkillMetadata } from "@codex-mobile/protocol/v2";

import { buildRateLimitsDisplay, type RateLimitDisplayItem, type RateLimitsDisplay } from "@/lib/rateLimitFormat";
import { getSupportedReasoningEfforts } from "@/lib/reasoningEffort";
import type { ComposerMention } from "@/types/composer";
import { PERMISSION_MODES, isBuiltInPermissionModeId, type PermissionModeId } from "@/types/permissionMode";

type Props = {
  isLoading?: boolean;
  models: Model[];
  permissionProfiles: PermissionProfileSummary[];
  plugins: PluginSummary[];
  rateLimits?: GetAccountRateLimitsResponse | null;
  selectedModelId: string | null;
  selectedReasoningEffort: string | null;
  selectedPermissionModeId: PermissionModeId;
  skills: SkillMetadata[];
  visible: boolean;
  onClose: () => void;
  onPickImages: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onRunCommand: () => void;
  onSelectMention: (mention: ComposerMention) => void;
  onSelectModel: (modelId: string) => void;
  onSelectReasoningEffort: (effort: string) => void;
  onSelectPermissionMode: (modeId: PermissionModeId) => void;
};

type ToolListItem =
  | { type: "quick" }
  | { type: "models" }
  | { type: "reasoning" }
  | { type: "rateLimitHeader"; display: RateLimitsDisplay }
  | { type: "rateLimit"; bucket: RateLimitDisplayItem }
  | { type: "permissionModes" }
  | { type: "section"; id: string; title: string }
  | { type: "skill"; skill: SkillMetadata }
  | { type: "plugin"; plugin: PluginSummary }
  | { type: "empty"; id: string; text: string };

export function ComposerToolsModal({
  isLoading = false,
  models,
  permissionProfiles,
  plugins,
  rateLimits = null,
  selectedModelId,
  selectedReasoningEffort,
  selectedPermissionModeId,
  skills,
  visible,
  onClose,
  onPickImages,
  onRefresh,
  onRunCommand,
  onSelectMention,
  onSelectModel,
  onSelectReasoningEffort,
  onSelectPermissionMode,
}: Props) {
  const [activePluginId, setActivePluginId] = useState<string | null>(null);
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = Math.min(640, Math.max(360, windowHeight * 0.78));
  const listHeight = sheetHeight - 58;

  // 额度只在拉到快照后展示，避免加载中闪出「暂无额度数据」。
  const rateLimitsDisplay = useMemo(() => buildRateLimitsDisplay(rateLimits), [rateLimits]);
  const rateLimitSignature = useMemo(() => {
    if (!rateLimitsDisplay) {
      return "";
    }

    const itemKey = rateLimitsDisplay.items.map((item) => item.key).join("|");

    return `${rateLimitsDisplay.planLabel ?? ""}#${rateLimitsDisplay.resetCreditsLabel ?? ""}#${itemKey}`;
  }, [rateLimitsDisplay]);

  const data = useMemo<ToolListItem[]>(() => {
    const items: ToolListItem[] = [
      { type: "quick" },
      { type: "section", id: "models-title", title: "模型" },
      { type: "models" },
      { type: "section", id: "reasoning-title", title: "思考程度" },
      { type: "reasoning" },
      { type: "section", id: "permissions-title", title: "权限模式" },
      { type: "permissionModes" },
    ];

    if (rateLimitsDisplay) {
      items.push({ type: "section", id: "rate-limits-title", title: "额度" });

      if (rateLimitsDisplay.items.length) {
        items.push({ type: "rateLimitHeader", display: rateLimitsDisplay });
        items.push(...rateLimitsDisplay.items.map((bucket) => ({ type: "rateLimit" as const, bucket })));
      } else {
        items.push({ type: "empty", id: "rate-limits-empty", text: "暂无额度数据" });
      }
    }

    items.push({ type: "section", id: "skills-title", title: "Skills" });
    if (skills.length) {
      items.push(...skills.map((skill) => ({ type: "skill" as const, skill })));
    } else {
      items.push({ type: "empty", id: "skills-empty", text: "暂无可用 Skill" });
    }

    items.push({ type: "section", id: "plugins-title", title: "Plugins" });
    if (plugins.length) {
      items.push(...plugins.map((plugin) => ({ type: "plugin" as const, plugin })));
    } else {
      items.push({ type: "empty", id: "plugins-empty", text: "暂无已启用插件" });
    }

    return items;
  }, [plugins, skills, rateLimitsDisplay]);

  const visiblePermissionProfiles = useMemo(
    () => permissionProfiles.filter((profile) => !isBuiltInPermissionModeId(profile.id)),
    [permissionProfiles],
  );

  const renderItem = useCallback(
    ({ item }: { item: ToolListItem }) => {
      switch (item.type) {
        case "quick":
          return (
            <View style={styles.quickGrid}>
              <Pressable onPress={() => void onPickImages()} style={styles.quickAction}>
                <Ionicons color="#2454d6" name="image-outline" size={20} />
                <View style={styles.quickTextWrap}>
                  <Text style={styles.actionTitle}>图片</Text>
                  <Text style={styles.actionText}>从手机相册选择</Text>
                </View>
              </Pressable>
              <Pressable onPress={onRunCommand} style={styles.quickAction}>
                <Ionicons color="#2454d6" name="terminal-outline" size={20} />
                <View style={styles.quickTextWrap}>
                  <Text style={styles.actionTitle}>命令</Text>
                  <Text style={styles.actionText}>执行 shell command</Text>
                </View>
              </Pressable>
            </View>
          );
        case "models":
          return (
            <View style={styles.modelWrap}>
              {models.length ? (
                models.map((model) => (
                  <Pressable
                    key={model.model}
                    onPress={() => onSelectModel(model.model)}
                    style={[styles.modelPill, selectedModelId === model.model && styles.modelPillActive]}
                  >
                    <Text style={[styles.modelText, selectedModelId === model.model && styles.modelTextActive]}>{model.displayName || model.model}</Text>
                  </Pressable>
                ))
              ) : (
                <Text style={styles.emptyText}>暂无模型数据</Text>
              )}
            </View>
          );
        case "reasoning": {
          const model = models.find((candidate) => candidate.model === selectedModelId);
          const effortOptions = getSupportedReasoningEfforts(model ?? null);
          return (
            <View style={styles.modelWrap}>
              {effortOptions.length ? effortOptions.map((option) => (
                <Pressable key={option.id} onPress={() => onSelectReasoningEffort(option.id)} style={[styles.modelPill, selectedReasoningEffort === option.id && styles.modelPillActive]}>
                  <Text style={[styles.modelText, selectedReasoningEffort === option.id && styles.modelTextActive]}>{option.label}</Text>
                </Pressable>
              )) : <Text style={styles.emptyText}>当前模型不支持选择思考程度</Text>}
            </View>
          );
        }
        case "permissionModes":
          return (
            <View style={styles.permissionWrap}>
              {PERMISSION_MODES.map((mode) => (
                <Pressable
                  key={mode.id}
                  onPress={() => onSelectPermissionMode(mode.id)}
                  style={[styles.permissionAction, selectedPermissionModeId === mode.id && styles.permissionActionActive, mode.id === "full" && styles.permissionActionDanger]}
                >
                  <View style={styles.permissionTitleRow}>
                    <Text style={[styles.actionTitle, selectedPermissionModeId === mode.id && styles.permissionTitleActive]}>{mode.label}</Text>
                    {selectedPermissionModeId === mode.id ? <Ionicons color={mode.id === "full" ? "#b42318" : "#2454d6"} name="checkmark-circle" size={17} /> : null}
                  </View>
                  <Text style={styles.actionText}>{mode.description}</Text>
                </Pressable>
              ))}
              {visiblePermissionProfiles.map((profile) => (
                <Pressable
                  key={profile.id}
                  onPress={() => onSelectPermissionMode(profile.id)}
                  style={[styles.permissionAction, selectedPermissionModeId === profile.id && styles.permissionActionActive]}
                >
                  <View style={styles.permissionTitleRow}>
                    <Text style={[styles.actionTitle, selectedPermissionModeId === profile.id && styles.permissionTitleActive]}>
                      {profile.description || profile.id}
                    </Text>
                    {selectedPermissionModeId === profile.id ? <Ionicons color="#2454d6" name="checkmark-circle" size={17} /> : null}
                  </View>
                  <Text style={styles.actionText}>{profile.id}</Text>
                </Pressable>
              ))}
            </View>
          );
        case "rateLimitHeader":
          return (
            <View style={styles.rateLimitMetaRow}>
              {item.display.planLabel ? (
                <View style={styles.rateLimitBadge}>
                  <Text style={styles.rateLimitBadgeText}>{item.display.planLabel}</Text>
                </View>
              ) : null}
              {item.display.resetCreditsLabel ? <Text style={styles.rateLimitMetaText}>{item.display.resetCreditsLabel}</Text> : null}
              <Text style={styles.rateLimitMetaText}>点击右侧刷新更新</Text>
            </View>
          );
        case "rateLimit":
          return (
            <View style={styles.rateLimitCard}>
              <View style={styles.rateLimitHead}>
                <Text numberOfLines={1} style={styles.actionTitle}>
                  {item.bucket.title}
                </Text>
                {item.bucket.depleted ? (
                  <View style={styles.rateLimitDepletedBadge}>
                    <Text style={styles.rateLimitDepletedText}>已达上限</Text>
                  </View>
                ) : null}
                <Text style={[styles.rateLimitPercent, item.bucket.depleted && styles.rateLimitPercentDanger]}>
                  {item.bucket.unlimited ? "不限" : formatRemainingPercent(item.bucket.primary, item.bucket.secondary)}
                </Text>
              </View>
              {item.bucket.primary ? <Text style={styles.actionText}>剩余 {formatWindowLine(item.bucket.primary)}</Text> : null}
              {item.bucket.secondary ? <Text style={styles.actionText}>剩余 {formatWindowLine(item.bucket.secondary)}</Text> : null}
              {item.bucket.creditsLabel ? <Text style={styles.actionText}>{item.bucket.creditsLabel}</Text> : null}
              {!item.bucket.primary && !item.bucket.secondary && !item.bucket.creditsLabel ? (
                <Text style={styles.emptyText}>暂无该额度窗口数据</Text>
              ) : null}
            </View>
          );
        case "section":
          return <Text style={styles.sectionTitle}>{item.title}</Text>;
        case "skill":
          return (
            <Pressable
              onPress={() => onSelectMention({ type: "skill", name: item.skill.name, path: item.skill.path })}
              style={styles.action}
            >
              <Text style={styles.actionTitle}>${item.skill.name}</Text>
              <Text numberOfLines={2} style={styles.actionText}>
                {item.skill.interface?.shortDescription || item.skill.shortDescription || item.skill.description}
              </Text>
            </Pressable>
          );
        case "plugin":
          return (
            <Pressable onPress={() => setActivePluginId(item.plugin.id)} style={[styles.action, activePluginId === item.plugin.id && styles.pluginActionActive]}>
              <View style={styles.pluginTitleRow}>
                <Text numberOfLines={1} style={styles.actionTitle}>
                  {item.plugin.interface?.displayName || item.plugin.name}
                </Text>
                <Text style={styles.pluginBadge}>{activePluginId === item.plugin.id ? "已启用" : item.plugin.source.type}</Text>
              </View>
              <Text numberOfLines={2} style={styles.actionText}>
                {activePluginId === item.plugin.id
                  ? "插件能力已在电脑端启用；可通过上方 Skills 选择具体能力。"
                  : item.plugin.interface?.shortDescription || item.plugin.interface?.longDescription || item.plugin.name}
              </Text>
            </Pressable>
          );
        case "empty":
          return <Text style={styles.emptyText}>{item.text}</Text>;
      }
    },
    [
      activePluginId,
      models,
      onPickImages,
      onRunCommand,
      onSelectMention,
      onSelectModel,
      onSelectReasoningEffort,
      onSelectPermissionMode,
      rateLimitSignature,
      selectedModelId,
      selectedReasoningEffort,
      selectedPermissionModeId,
      visiblePermissionProfiles,
    ],
  );

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable onPress={onClose} style={styles.backdrop} />
        <View style={[styles.sheet, { height: sheetHeight }]}>
          <View style={styles.header}>
            <Text style={styles.title}>输入增强</Text>
            <Pressable onPress={() => void onRefresh()} style={styles.refreshButton}>
              <Text style={styles.refreshText}>{isLoading ? "..." : "刷新"}</Text>
            </Pressable>
          </View>

          <View style={[styles.listFrame, { height: listHeight }]}>
            <FlashList
              data={data}
              drawDistance={500}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              ItemSeparatorComponent={ToolItemSeparator}
              style={styles.list}
              contentContainerStyle={styles.listContent}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function keyExtractor(item: ToolListItem) {
  switch (item.type) {
    case "quick":
      return "quick";
    case "models":
      return "models";
    case "reasoning":
      return "reasoning";
    case "rateLimitHeader":
      return `rate-limits-header:${rateLimitSignature(item.display)}`;
    case "rateLimit":
      return `rate-limit:${item.bucket.key}`;
    case "permissionModes":
      return "permissionModes";
    case "section":
      return item.id;
    case "skill":
      return `skill:${item.skill.path}`;
    case "plugin":
      return `plugin:${item.plugin.id}`;
    case "empty":
      return item.id;
  }
}

function ToolItemSeparator() {
  return <View style={styles.separator} />;
}

// 双窗口时主行只展示最紧的那个窗口，明细在下一行分别展开。
function formatRemainingPercent(
  primary: RateLimitDisplayItem["primary"],
  secondary: RateLimitDisplayItem["secondary"],
) {
  const windows = [primary, secondary].filter((window): window is NonNullable<typeof window> => Boolean(window));

  if (!windows.length) {
    return "—";
  }

  return `${Math.min(...windows.map((window) => window.remainingPercent))}%`;
}

function formatWindowLine(window: NonNullable<RateLimitDisplayItem["primary"]>) {
  const percentText = `${window.remainingPercent}%`;
  const details = [window.periodLabel, window.resetLabel].filter((part): part is string => Boolean(part));

  return details.length ? `${percentText} · ${details.join(" · ")}` : percentText;
}

function rateLimitSignature(display: RateLimitsDisplay) {
  return `${display.planLabel ?? ""}#${display.resetCreditsLabel ?? ""}`;
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 14,
  },
  backdrop: {
    backgroundColor: "rgba(24, 34, 48, 0.28)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  sheet: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 14,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: {
    color: "#182230",
    fontSize: 16,
    fontWeight: "900",
  },
  refreshButton: {
    backgroundColor: "#edf1f7",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  refreshText: {
    color: "#304052",
    fontSize: 12,
    fontWeight: "800",
  },
  list: {
    flex: 1,
  },
  listFrame: {
    overflow: "hidden",
  },
  listContent: {
    paddingBottom: 6,
  },
  separator: {
    height: 8,
  },
  quickGrid: {
    gap: 8,
  },
  quickAction: {
    alignItems: "center",
    backgroundColor: "#f4f7fb",
    borderColor: "#d8dee8",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  quickTextWrap: {
    flex: 1,
    gap: 2,
  },
  action: {
    backgroundColor: "#f4f7fb",
    borderColor: "#d8dee8",
    borderRadius: 12,
    borderWidth: 1,
    gap: 3,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  actionTitle: {
    color: "#182230",
    fontSize: 14,
    fontWeight: "900",
  },
  actionText: {
    color: "#6b7788",
    fontSize: 12,
    lineHeight: 17,
  },
  pluginBadge: {
    backgroundColor: "#e8eef8",
    borderRadius: 999,
    color: "#526073",
    fontSize: 11,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  pluginActionActive: {
    backgroundColor: "#eef4ff",
    borderColor: "#9db7f4",
  },
  pluginTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: "#304052",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 6,
    textTransform: "uppercase",
  },
  modelWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  modelPill: {
    backgroundColor: "#f4f7fb",
    borderColor: "#d8dee8",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  modelPillActive: {
    backgroundColor: "#2454d6",
    borderColor: "#2454d6",
  },
  modelText: {
    color: "#304052",
    fontSize: 12,
    fontWeight: "800",
  },
  modelTextActive: {
    color: "#ffffff",
  },
  permissionWrap: {
    gap: 8,
  },
  permissionAction: {
    backgroundColor: "#f4f7fb",
    borderColor: "#d8dee8",
    borderRadius: 12,
    borderWidth: 1,
    gap: 3,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  permissionActionActive: {
    backgroundColor: "#eef4ff",
    borderColor: "#9db7f4",
  },
  permissionActionDanger: {
    borderColor: "#f0b8b8",
  },
  permissionTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  permissionTitleActive: {
    color: "#2454d6",
  },
  rateLimitMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  rateLimitBadge: {
    backgroundColor: "#e8eef8",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  rateLimitBadgeText: {
    color: "#2454d6",
    fontSize: 11,
    fontWeight: "900",
  },
  rateLimitMetaText: {
    color: "#6b7788",
    fontSize: 12,
  },
  rateLimitCard: {
    backgroundColor: "#f4f7fb",
    borderColor: "#d8dee8",
    borderRadius: 12,
    borderWidth: 1,
    gap: 3,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  rateLimitHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  rateLimitPercent: {
    color: "#2454d6",
    fontSize: 15,
    fontWeight: "900",
  },
  rateLimitPercentDanger: {
    color: "#b42318",
  },
  rateLimitDepletedBadge: {
    backgroundColor: "#fdecec",
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  rateLimitDepletedText: {
    color: "#b42318",
    fontSize: 11,
    fontWeight: "900",
  },
  emptyText: {
    color: "#6b7788",
    fontSize: 12,
    paddingVertical: 4,
  },
});
