import { useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { ThreadDetail } from "@/components/ThreadDetail";
import { HomeTabs } from "@/components/app-shell/HomeTabs";
import { loadSavedConnectionConfig } from "@/hooks/codex-app-server/connectionStorage";
import type { RootTab } from "@/components/app-shell/RootTabBar";
import { useCodexAppServer } from "@/hooks/useCodexAppServer";
import type { Thread } from "@codex-mobile/protocol/v2";
import type { ComposerImageAttachment } from "@/types/composer";

export default function App() {
  const codex = useCodexAppServer();
  const [activeTab, setActiveTab] = useState<RootTab>("threads");
  const [isDraftThread, setIsDraftThread] = useState(false);
  const [draftCwd, setDraftCwd] = useState("");
  const autoConnectAttemptedRef = useRef(false);
  const isDetailView = Boolean(codex.selectedThread) || isDraftThread;

  useEffect(() => {
    if (activeTab !== "threads" || autoConnectAttemptedRef.current || !shouldAutoConnect(codex.state)) {
      return;
    }

    autoConnectAttemptedRef.current = true;
    let cancelled = false;

    const autoConnect = async () => {
      try {
        const savedConfig = await loadSavedConnectionConfig();
        if (!cancelled && savedConfig?.url.trim()) {
          codex.connect(savedConfig.url, savedConfig.token);
        }
      } catch (error) {
        console.warn("auto connect failed", error);
      }
    };

    void autoConnect();

    return () => {
      cancelled = true;
    };
  }, [activeTab, codex.connect, codex.state]);

  const openThread = (thread: Thread) => {
    setIsDraftThread(false);
    void codex.openThread(thread);
  };

  const closeThread = () => {
    setIsDraftThread(false);
    codex.closeThread();
  };

  const startDraftThread = () => {
    const defaultCwd = codex.selectedThread?.cwd || codex.recentCwds[0] || "";
    codex.closeThread();
    setDraftCwd(defaultCwd);
    setIsDraftThread(true);
  };

  const sendDraftMessage = async (
    text: string,
    mentions: Parameters<typeof codex.sendMessage>[1] = [],
    images: ComposerImageAttachment[] = [],
  ) => {
    await codex.createThread(draftCwd, text, mentions, images);
    setIsDraftThread(false);
  };

  if (isDetailView) {
    return (
      <SafeAreaProvider>
        <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
          <StatusBar style="dark" />
          {/* 详情页底部输入框贴近屏幕底部，键盘出现时需要由 RN 层主动让出空间。 */}
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={Platform.OS === "ios" ? -12 : 0}
            style={styles.detailScreen}
          >
            <ThreadDetail
              activeTurnId={isDraftThread ? null : codex.activeTurnId}
              approval={codex.approval}
              userInputRequest={codex.userInputRequest}
              draftCwd={draftCwd}
              hasMoreMessages={isDraftThread ? false : codex.hasMoreMessages}
              isLoadingPickerData={codex.isLoadingPickerData}
              isDraft={isDraftThread}
              isLoading={isDraftThread ? false : codex.isOpeningThread}
              isLoadingMore={codex.isLoadingMore}
              isRefreshing={codex.isRefreshingThread}
              isInterrupting={codex.isInterruptingTurn}
              isResponding={isDraftThread ? codex.isCreatingThread : codex.isResponding}
              models={codex.pickerData.models}
              permissionProfiles={codex.pickerData.permissionProfiles}
              plugins={codex.pickerData.plugins}
              rateLimits={codex.rateLimits}
              recentCwds={codex.recentCwds}
              selectedModelId={codex.selectedModelId}
              selectedReasoningEffort={codex.selectedReasoningEffort}
              selectedPermissionModeId={codex.selectedPermissionModeId}
              statusLabel={isDraftThread ? "新会话" : codex.statusLabel}
              skills={codex.pickerData.skills}
              onBack={closeThread}
              onArchiveThread={codex.archiveSelectedThread}
              onChangeDraftCwd={setDraftCwd}
              onCreateNew={startDraftThread}
              onDownloadHostFile={codex.downloadFileFromHost}
              onInterrupt={codex.interruptTurn}
              onLoadMore={codex.loadOlderMessages}
              onRefresh={codex.refreshSelectedThread}
              onRefreshPickerData={codex.refreshPickerData}
              onRenameThread={codex.renameThread}
              onReviewThread={codex.startCurrentReview}
              onResolveApproval={codex.resolveApproval}
              onResolveUserInputRequest={codex.resolveUserInputRequest}
              onRunShellCommand={codex.runShellCommand}
              onSelectModel={codex.setSelectedModelId}
              onSelectReasoningEffort={codex.setSelectedReasoningEffort}
              onSelectPermissionMode={codex.setSelectedPermissionModeId}
              onSend={isDraftThread ? sendDraftMessage : codex.sendMessage}
              thread={codex.selectedThread}
              timeline={isDraftThread ? [] : codex.timeline}
            />
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
        <StatusBar style="dark" />
        <HomeTabs activeTab={activeTab} codex={codex} onCreateThread={startDraftThread} onOpenThread={openThread} onTabChange={setActiveTab} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function shouldAutoConnect(state: ReturnType<typeof useCodexAppServer>["state"]) {
  return state === "idle" || state === "closed" || state === "error";
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: "#f4f7fb",
    flex: 1,
  },
  detailScreen: {
    flex: 1,
  },
});
