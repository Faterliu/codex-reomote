import { createThemedStyles, useAppTheme } from "@/theme/AppTheme";
import { useRef, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";

import { DEFAULT_APP_SERVER_URL } from "@/hooks/codex-app-server/connectionStorage";
import type { ConnectionProfile } from "@/hooks/codex-app-server/connectionProfiles";
import { useConnectionProfiles } from "@/hooks/useConnectionProfiles";
import { ConnectionProfileList } from "./connection/ConnectionProfileList";
import type { ConnectionState, ReadinessStatus } from "@/types/codex";

type Props = {
  state: ConnectionState;
  readiness: ReadinessStatus | null;
  recentError?: string | null;
  onConnect: (url: string, token: string) => void;
  onDisconnect: () => void;
  onProbe: (url: string, token: string) => void;
};

export function ConnectionPanel({ state, readiness, recentError = null, onConnect, onDisconnect, onProbe }: Props) {
  const styles = useStyles();
  const { isDark } = useAppTheme();
  const accounts = useConnectionProfiles();
  const { url, setUrl, token, setToken, status: storageStatus, setStatus: setStorageStatus } = accounts;
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scannerLocked, setScannerLocked] = useState(false);
  // 三行连接信息默认收起，只有「新增账号」或选中某个账号时才展开编辑区。
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scannerLockedRef = useRef(false);
  const isConnecting = state === "connecting" || state === "reconnecting";

  const openScanner = async () => {
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();

    if (!permission.granted) {
      setStorageStatus("没有相机权限，无法扫码导入");
      return;
    }

    scannerLockedRef.current = false;
    setScannerLocked(false);
    setScannerVisible(true);
  };

  const handleScanned = (result: BarcodeScanningResult) => {
    if (scannerLockedRef.current) {
      return;
    }

    scannerLockedRef.current = true;
    setScannerLocked(true);
    const parsed = parseConnectionQr(result.data);

    if (!parsed) {
      setStorageStatus("二维码不是 Codex Mobile 连接配置");
      scannerLockedRef.current = false;
      setScannerLocked(false);
      return;
    }

    accounts.importConfig(parsed);
    // 扫码导入的是新账号草稿，展开编辑区让用户补名称。
    setIsEditorOpen(true);
    setScannerVisible(false);
  };

  const handleCreateProfile = () => {
    accounts.create();
    setIsEditorOpen(true);
  };

  const handleSelectProfile = (profile: ConnectionProfile) => {
    accounts.select(profile);
    setIsEditorOpen(true);
  };

  const handleSaveProfile = async () => {
    await accounts.save();
    setIsEditorOpen(false);
  };

  const handleConnect = async () => {
    await accounts.connect(onConnect);
    setIsEditorOpen(false);
  };

  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <Text style={styles.title}>连接设置</Text>
        <Text
          style={[
            styles.badge,
            state === "connected" && styles.badgeConnected,
            state === "reconnecting" && styles.badgeReconnecting,
          ]}
        >
          {getStateLabel(state)}
        </Text>
      </View>
      <ConnectionProfileList
        profiles={accounts.profiles}
        selectedId={accounts.selectedId}
        disabled={accounts.isBusy || isConnecting}
        isLoading={accounts.isLoading}
        onSelect={handleSelectProfile}
        onCreate={handleCreateProfile}
        onDelete={(profile) => void accounts.remove(profile)}
      />
      {isEditorOpen ? (
        <View style={styles.editor}>
          <View style={styles.editorHeader}>
            <Text style={styles.editorTitle}>{accounts.selectedId ? "编辑账号" : "新增账号"}</Text>
            <Text style={styles.editorHint}>{accounts.selectedId ? "保存后继续用于连接" : "填写后保存为新账号"}</Text>
          </View>
          <Text style={styles.fieldLabel}>账号名称</Text>
          <TextInput
            accessibilityLabel="账号名称"
            editable={!accounts.isBusy && !isConnecting}
            onChangeText={accounts.setName}
            placeholder="例如：家用电脑、工作电脑"
            maxLength={60}
            style={styles.input}
            value={accounts.name}
            keyboardAppearance={isDark ? "dark" : "light"}
          />
          <Text style={styles.fieldLabel}>连接网址</Text>
          <TextInput
            accessibilityLabel="连接网址"
            editable={!accounts.isBusy && !isConnecting}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setUrl}
            placeholder={DEFAULT_APP_SERVER_URL}
            style={styles.input}
            value={url}
            keyboardAppearance={isDark ? "dark" : "light"}
          />
          <Text style={styles.fieldLabel}>Relay token</Text>
          <TextInput
            accessibilityLabel="Relay token"
            editable={!accounts.isBusy && !isConnecting}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setToken}
            placeholder="relay token / capability token"
            secureTextEntry
            style={styles.input}
            value={token}
            keyboardAppearance={isDark ? "dark" : "light"}
          />
          <View style={styles.actions}>
            <Pressable disabled={accounts.isBusy || isConnecting} onPress={() => void handleSaveProfile()} style={[styles.primaryButton, (accounts.isBusy || isConnecting) && styles.disabledButton]}>
              <Text style={styles.primaryButtonText}>{accounts.selectedId ? "保存账号修改" : "保存为新账号"}</Text>
            </Pressable>
            <Pressable disabled={accounts.isBusy} onPress={() => setIsEditorOpen(false)} style={[styles.secondaryButton, styles.flexButton, accounts.isBusy && styles.disabledButton]}>
              <Text style={styles.secondaryButtonText}>取消</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {readiness ? (
        <Text style={[styles.readiness, readiness.ok ? styles.readinessOk : styles.readinessError]}>
          {readiness.ok ? `readyz ${readiness.status}` : readiness.error}
        </Text>
      ) : null}
      {storageStatus ? <Text style={styles.storageText}>{storageStatus}</Text> : null}
      {recentError ? <Text style={styles.errorText}>{recentError}</Text> : null}
      <Pressable disabled={accounts.isBusy || isConnecting} onPress={() => void openScanner()} style={[styles.scanButton, (accounts.isBusy || isConnecting) && styles.disabledButton]}>
        <Text style={styles.scanText}>扫码导入</Text>
      </Pressable>
      <View style={styles.actions}>
        <Pressable disabled={isConnecting || accounts.isBusy} onPress={() => void handleConnect()} style={[styles.primaryButton, (isConnecting || accounts.isBusy) && styles.disabledButton]}>
          <Text style={styles.primaryButtonText}>{isConnecting ? "连接中..." : "连接"}</Text>
        </Pressable>
        <Pressable disabled={accounts.isBusy} onPress={onDisconnect} style={[styles.secondaryButton, styles.disconnectButton, accounts.isBusy && styles.disabledButton]}>
          <Text style={styles.secondaryButtonText}>断开</Text>
        </Pressable>
      </View>
      <Pressable disabled={accounts.isBusy || isConnecting} onPress={() => onProbe(url, token)} style={styles.probeButton}>
        <Text style={styles.probeText}>检测 readyz</Text>
      </Pressable>
      <ConnectionQrScannerModal
        onClose={() => setScannerVisible(false)}
        onScanned={handleScanned}
        visible={scannerVisible}
      />
    </View>
  );
}

type ParsedConnectionQr = {
  url: string;
  token: string;
};

function parseConnectionQr(raw: string): ParsedConnectionQr | null {
  const trimmed = raw.trim();

  try {
    const parsedJson = JSON.parse(trimmed) as { kind?: string; url?: string; token?: string };
    if (parsedJson.kind === "codex-mobile-connection" && parsedJson.url && parsedJson.token) {
      return {
        url: parsedJson.url,
        token: parsedJson.token,
      };
    }
  } catch {
    // 兼容直接扫描完整 wss://...?relay_token=... URL。
  }

  try {
    const parsedUrl = new URL(trimmed);
    const relayToken = parsedUrl.searchParams.get("relay_token") || "";
    parsedUrl.searchParams.delete("relay_token");

    if ((parsedUrl.protocol === "ws:" || parsedUrl.protocol === "wss:") && relayToken) {
      return {
        url: parsedUrl.toString(),
        token: relayToken,
      };
    }
  } catch {
    return null;
  }

  return null;
}

type ConnectionQrScannerModalProps = {
  visible: boolean;
  onClose: () => void;
  onScanned: (result: BarcodeScanningResult) => void;
};

function ConnectionQrScannerModal({ visible, onClose, onScanned }: ConnectionQrScannerModalProps) {
  const styles = useStyles();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.scannerBackdrop}>
        <View style={styles.scannerSheet}>
          <View style={styles.scannerHeader}>
            <Text style={styles.scannerTitle}>扫描连接二维码</Text>
            <Pressable onPress={onClose} style={styles.scannerCloseButton}>
              <Text style={styles.scannerCloseText}>关闭</Text>
            </Pressable>
          </View>
          <View style={styles.cameraWrap}>
            <CameraView
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={onScanned}
              style={styles.camera}
            />
            <View style={styles.scanFrame} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function getStateLabel(state: ConnectionState) {
  if (state === "connected") {
    return "已连接";
  }

  if (state === "connecting") {
    return "连接中";
  }

  if (state === "reconnecting") {
    return "重连中";
  }

  if (state === "closed") {
    return "已断开";
  }

  if (state === "error") {
    return "连接错误";
  }

  return "未连接";
}

const useStyles = createThemedStyles({
  panel: {
    gap: 10,
    padding: 14,
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 16,
    borderWidth: 1,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  title: {
    color: "#182230",
    fontSize: 16,
    fontWeight: "700",
  },
  badge: {
    backgroundColor: "#edf1f7",
    borderRadius: 6,
    color: "#516071",
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeConnected: {
    backgroundColor: "#dff7e8",
    color: "#19663b",
  },
  badgeReconnecting: {
    backgroundColor: "#fff4d8",
    color: "#8a5a00",
  },
  input: {
    backgroundColor: "#f8fafc",
    borderColor: "#d8dee8",
    borderRadius: 12,
    borderWidth: 1,
    color: "#182230",
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fieldLabel: {
    color: "#516071",
    fontSize: 12,
    fontWeight: "700",
  },
  editor: {
    backgroundColor: "#f4f7fb",
    borderColor: "#d8dee8",
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  editorHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  editorTitle: {
    color: "#182230",
    fontSize: 14,
    fontWeight: "800",
  },
  editorHint: {
    color: "#697789",
    fontSize: 11,
  },
  flexButton: { flex: 1 },
  readiness: {
    borderRadius: 8,
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  readinessOk: {
    backgroundColor: "#dff7e8",
    color: "#19663b",
  },
  readinessError: {
    backgroundColor: "#fff1f1",
    color: "#9b2222",
  },
  scanButton: {
    alignItems: "center",
    backgroundColor: "#182230",
    borderRadius: 999,
    paddingVertical: 11,
  },
  scanText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  errorText: {
    backgroundColor: "#fff1f1",
    borderRadius: 8,
    color: "#9b2222",
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  storageText: {
    backgroundColor: "#edf7ff",
    borderRadius: 8,
    color: "#2454d6",
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#2454d6",
    borderRadius: 999,
    flex: 1,
    paddingVertical: 11,
  },
  disabledButton: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#cfd7e3",
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 11,
  },
  secondaryButtonText: {
    color: "#304052",
    fontWeight: "700",
  },
  disconnectButton: { flex: 1 },
  probeButton: {
    alignItems: "center",
    borderColor: "#cfd7e3",
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 10,
  },
  probeText: {
    color: "#304052",
    fontWeight: "700",
  },
  scannerBackdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    flex: 1,
    justifyContent: "flex-end",
  },
  scannerSheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: "hidden",
    paddingBottom: 14,
  },
  scannerHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  scannerTitle: {
    color: "#182230",
    fontSize: 16,
    fontWeight: "900",
  },
  scannerCloseButton: {
    backgroundColor: "#edf1f7",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  scannerCloseText: {
    color: "#304052",
    fontSize: 12,
    fontWeight: "900",
  },
  camera: {
    flex: 1,
  },
  cameraWrap: {
    height: 360,
    marginHorizontal: 14,
    overflow: "hidden",
  },
  scanFrame: {
    borderColor: "#ffffff",
    borderRadius: 18,
    borderWidth: 3,
    height: 220,
    left: "50%",
    marginLeft: -110,
    marginTop: -110,
    position: "absolute",
    top: "50%",
    width: 220,
  },
});
