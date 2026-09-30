import { useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, ToastAndroid } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { ThreadDetail } from "@/components/ThreadDetail";
import { AppUpdatePrompt } from "@/components/app-update/AppUpdatePrompt";
import { HomeTabs } from "@/components/app-shell/HomeTabs";
import { loadSavedConnectionConfig } from "@/hooks/codex-app-server/connectionStorage";
import { useAutoRotateSetting } from "@/hooks/useAutoRotateSetting";
import type { RootTab } from "@/components/app-shell/RootTabBar";
import { useCodexAppServer } from "@/hooks/useCodexAppServer";
import type { Thread } from "@codex-mobile/protocol/v2";
import type { ComposerImageAttachment } from "@/types/composer";
import { useAppUpdater } from "@/hooks/useAppUpdater";

export default function App() {
  const codex = useCodexAppServer();
  const appUpdater = useAppUpdater();
  const autoRotateSetting = useAutoRotateSetting();
  const [activeTab, setActiveTab] = useState<RootTab>("threads");
  const [isDraftThread, setIsDraftThread] = useState(false);
  const [draftCwd, setDraftCwd] = useState("");
  const autoConnectAttemptedRef = useRef(false);
  const isDetailView = Boolean(codex.selectedThread) || isDraftThread;

  const handleCheckForUpdates = async () => {
    try {
      const hasUpdate = await appUpdater.checkForUpdate();
      if (!hasUpdate && Platform.OS === "android") {
        ToastAndroid.show("当前已是最新版本", ToastAndroid.SHORT);
      }
    } catch (error) {
      Alert.alert(
        "检查更新失败",
        error instanceof Error ? error.message : "请检查网络连接后重试。",
      );
    }
  };

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

  // 从某一轮开新分支：边界是真实 turn.id，成功后 hook 内部已切到新 thread 并锁好输入框。
  const forkTurn = async (turnId: string) => {
    const threadId = codex.selectedThread?.id;

    if (!threadId) {
      return;
    }

    try {
      await codex.forkThreadAtTurn({ threadId, turnId });

      if (Platform.OS === "android") {
        ToastAndroid.show("已从当前轮次创建新分支", ToastAndroid.SHORT);
      }
    } catch (error) {
      Alert.alert("无法创建分支", error instanceof Error ? error.message : "创建分支失败，请稍后重试。");
    }
  };

  if (isDetailView) {
    return (
      <SafeAreaProvider>
        <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
          <StatusBar style="dark" />
          <AppUpdatePrompt controller={appUpdater} />
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
              forkingTurnId={isDraftThread ? null : codex.forkingTurnId}
              hasMoreMessages={isDraftThread ? false : codex.hasMoreMessages}
              isLoadingPickerData={codex.isLoadingPickerData}
              isModelCatalogLoaded={codex.hasLoadedModelCatalog}
              selectedModelUnavailable={codex.selectedModelUnavailable}
              isDraft={isDraftThread}
              isLoading={isDraftThread ? false : codex.isOpeningThread}
              isLoadingMore={codex.isLoadingMore}
              isForkingThread={isDraftThread ? false : codex.isForkingThread}
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
              onForkTurn={forkTurn}
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
      <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
        <StatusBar style="dark" />
        <AppUpdatePrompt controller={appUpdater} />
        <HomeTabs
          activeTab={activeTab}
          codex={codex}
          isCheckingForUpdate={appUpdater.isCheckingForUpdate}
          onCheckForUpdates={() => void handleCheckForUpdates()}
          autoRotateSetting={autoRotateSetting}
          onCreateThread={startDraftThread}
          onOpenThread={openThread}
          onTabChange={setActiveTab}
        />
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
