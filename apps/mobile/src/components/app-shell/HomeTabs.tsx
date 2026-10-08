import { createThemedStyles, useAppTheme } from "@/theme/AppTheme";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { ApprovalBanner } from "@/components/ApprovalBanner";
import { AppSettingsPanel } from "@/components/app-shell/AppSettingsPanel";
import { ConnectionPanel } from "@/components/ConnectionPanel";
import { EventLog } from "@/components/EventLog";
import { ThreadList } from "@/components/ThreadList";
import { UserInputRequestCard } from "@/components/user-input/UserInputRequestCard";
import type { AutoRotateSettingController } from "@/hooks/useAutoRotateSetting";
import type { NightModeSettingController } from "@/hooks/useNightModeSetting";
import type { CodexAppServerState } from "@/hooks/useCodexAppServer";
import type { Thread } from "@codex-mobile/protocol/v2";

import { RootTabBar, type RootTab } from "./RootTabBar";

type Props = {
  activeTab: RootTab;
  codex: CodexAppServerState;
  onCreateThread: () => void;
  onOpenThread: (thread: Thread) => void;
  onTabChange: (tab: RootTab) => void;
  onCheckForUpdates: () => void;
  isCheckingForUpdate: boolean;
  autoRotateSetting: AutoRotateSettingController;
  nightModeSetting: NightModeSettingController;
};

export function HomeTabs({ activeTab, codex, onCreateThread, onOpenThread, onTabChange, onCheckForUpdates, isCheckingForUpdate, autoRotateSetting, nightModeSetting }: Props) {
  const styles = useStyles();
  const { color: themeColor } = useAppTheme();
  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Codex</Text>
          <Text style={styles.subtitle}>{activeTab === "connection" ? "连接管理" : activeTab === "threads" ? "会话" : "设置"}</Text>
        </View>
        <View style={styles.headerActions}>
          {Platform.OS === "android" ? (
            <Pressable
              accessibilityRole="button"
              disabled={isCheckingForUpdate}
              onPress={onCheckForUpdates}
              style={[styles.updateCheckButton, isCheckingForUpdate && styles.updateCheckButtonDisabled]}
            >
              {isCheckingForUpdate ? <ActivityIndicator color={themeColor("#2454d6")} size="small" /> : null}
              <Text style={styles.updateCheckButtonText}>{isCheckingForUpdate ? "检查中…" : "检查更新"}</Text>
            </Pressable>
          ) : null}
          {activeTab !== "settings" ? (
            <Text style={[styles.headerBadge, codex.state === "connected" && styles.headerBadgeConnected]}>{codex.state}</Text>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          activeTab === "threads" ? (
            <RefreshControl refreshing={codex.isRefreshingThreads} tintColor={themeColor("#2454d6")} onRefresh={codex.refreshThreads} />
          ) : undefined
        }
      >
        {activeTab === "connection" ? (
          <>
            <ConnectionPanel
              state={codex.state}
              readiness={codex.readiness}
              recentError={codex.recentError}
              onConnect={codex.connect}
              onDisconnect={codex.disconnect}
              onProbe={codex.probeReadiness}
            />
            <ApprovalBanner approval={codex.approval} compact onResolve={codex.resolveApproval} />
            <UserInputRequestCard compact request={codex.userInputRequest} onSubmit={codex.resolveUserInputRequest} />
            <EventLog events={codex.events} logs={codex.logs} />
          </>
        ) : activeTab === "threads" ? (
          <>
            <ApprovalBanner approval={codex.approval} compact onResolve={codex.resolveApproval} />
            <UserInputRequestCard compact request={codex.userInputRequest} onSubmit={codex.resolveUserInputRequest} />
            <ThreadList
              onCreateThread={onCreateThread}
              onOpen={onOpenThread}
              onRefresh={codex.refreshThreads}
              isRefreshing={codex.isRefreshingThreads}
              onRestore={codex.restoreThread}
              onToggleArchived={codex.toggleArchivedThreads}
              showArchived={codex.showArchivedThreads}
              selectedThreadId={codex.selectedThread?.id}
              threads={codex.displayedThreads}
            />
          </>
        ) : (
          <AppSettingsPanel autoRotateSetting={autoRotateSetting} nightModeSetting={nightModeSetting} />
        )}
      </ScrollView>

      <RootTabBar activeTab={activeTab} onChange={onTabChange} />
    </View>
  );
}

const useStyles = createThemedStyles({
  shell: {
    flex: 1,
  },
  content: {
    gap: 16,
    padding: 16,
    paddingBottom: 24,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  title: {
    color: "#121a26",
    fontSize: 32,
    fontWeight: "900",
  },
  subtitle: {
    color: "#516071",
    fontSize: 14,
    lineHeight: 20,
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  updateCheckButton: {
    alignItems: "center",
    backgroundColor: "#edf3ff",
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 10,
  },
  updateCheckButtonDisabled: {
    opacity: 0.65,
  },
  updateCheckButtonText: {
    color: "#2454d6",
    fontSize: 12,
    fontWeight: "800",
  },
  headerBadge: {
    backgroundColor: "#edf1f7",
    borderRadius: 999,
    color: "#516071",
    fontSize: 12,
    fontWeight: "800",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  headerBadgeConnected: {
    backgroundColor: "#dff7e8",
    color: "#19663b",
  },
});
