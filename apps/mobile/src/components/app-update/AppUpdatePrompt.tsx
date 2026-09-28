import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { AppUpdaterController } from "@/hooks/useAppUpdater";

type AppUpdatePromptProps = {
  controller: AppUpdaterController;
};

export function AppUpdatePrompt({ controller }: AppUpdatePromptProps) {
  const { update, status, progress, error } = controller;

  if (!update || !status) {
    return null;
  }

  const isDownloading = status === "downloading";
  const isInstallerOpen = status === "installer_opened";
  const needsPermission = status === "permission_required";
  const actionLabel = isDownloading
    ? "正在下载…"
    : needsPermission
      ? "继续安装"
      : isInstallerOpen
        ? "再次打开安装器"
        : status === "error"
          ? "重试"
          : "立即更新";

  return (
    <Modal
      animationType="fade"
      onRequestClose={controller.dismiss}
      transparent
      visible
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>发现新版本</Text>
          <Text style={styles.title}>Codex {update.versionName}</Text>
          <Text style={styles.version}>版本号 {update.versionCode}</Text>

          {update.changelog.length > 0 ? (
            <ScrollView style={styles.changelog}>
              {update.changelog.map((line, index) => (
                <Text key={`${index}-${line}`} style={styles.changeLine}>• {line}</Text>
              ))}
            </ScrollView>
          ) : null}

          {isDownloading ? (
            <View style={styles.progressSection}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressValue, { width: `${progress ?? 0}%` }]} />
              </View>
              <Text style={styles.helperText}>
                {progress === null ? "正在下载更新包…" : `${progress}%`}
              </Text>
            </View>
          ) : null}

          {needsPermission ? (
            <Text style={styles.helperText}>
              请在系统设置中允许 Codex 安装应用，返回后点击“继续安装”。
            </Text>
          ) : null}

          {isInstallerOpen ? (
            <Text style={styles.helperText}>
              已交给 Android 安装程序，请按系统提示确认更新。若刚才取消了安装，可再次打开安装器。
            </Text>
          ) : null}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={isDownloading}
            onPress={() => void controller.installOrDownload()}
            style={({ pressed }) => [styles.primaryButton, pressed && !isDownloading ? styles.pressed : null]}
          >
            {isDownloading ? <ActivityIndicator color="#ffffff" size="small" /> : null}
            <Text style={styles.primaryButtonText}>{actionLabel}</Text>
          </Pressable>

          {!update.forceUpdate ? (
            <Pressable accessibilityRole="button" onPress={controller.dismiss} style={styles.laterButton}>
              <Text style={styles.laterButtonText}>稍后</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: "center",
    backgroundColor: "rgba(12, 20, 30, 0.48)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    maxHeight: "82%",
    padding: 24,
    width: "100%",
  },
  eyebrow: {
    color: "#3674c5",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  title: {
    color: "#142235",
    fontSize: 24,
    fontWeight: "700",
    marginTop: 8,
  },
  version: {
    color: "#738094",
    fontSize: 13,
    marginTop: 4,
  },
  changelog: {
    marginTop: 18,
    maxHeight: 220,
  },
  changeLine: {
    color: "#344256",
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 7,
  },
  progressSection: {
    marginTop: 22,
  },
  progressTrack: {
    backgroundColor: "#e7edf5",
    borderRadius: 4,
    height: 8,
    overflow: "hidden",
  },
  progressValue: {
    backgroundColor: "#3674c5",
    borderRadius: 4,
    height: "100%",
  },
  helperText: {
    color: "#647287",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 16,
  },
  errorText: {
    color: "#b42318",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 14,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#2563a8",
    borderRadius: 13,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    marginTop: 22,
    minHeight: 48,
  },
  pressed: {
    opacity: 0.82,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  laterButton: {
    alignItems: "center",
    marginTop: 12,
    minHeight: 38,
    justifyContent: "center",
  },
  laterButtonText: {
    color: "#647287",
    fontSize: 14,
    fontWeight: "600",
  },
});
