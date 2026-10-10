import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { createThemedStyles, useAppTheme } from "@/theme/AppTheme";

type Props = { controlTarget: string | null; onStopDesktop: () => Promise<string>; onRestartAppServer: () => Promise<string> };

export function DesktopControlPanel({ controlTarget, onStopDesktop, onRestartAppServer }: Props) {
  const styles = useStyles();
  const { color } = useAppTheme();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<"stop" | "restart" | null>(null);
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);
  const execute = async (action: "stop" | "restart") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    setResult(null);
    try {
      setResult({ message: await (action === "stop" ? onStopDesktop() : onRestartAppServer()), ok: true });
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : "操作失败，请检查连接后重试。", ok: false });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>电脑端控制</Text>
      {controlTarget ? <Text style={styles.description}>操作目标：{controlTarget}。App Server 断开时仍可操作，只需 Relay 和公网通道保持运行。</Text> : null}
      <Text style={styles.description}>关闭当前连接电脑的桌面端，释放对话写入锁，再在手机重新打开原对话。会中断桌面端正在执行的任务。</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !controlTarget || Boolean(busy), busy: busy === "stop" }}
        disabled={!controlTarget || Boolean(busy)}
        style={[styles.button, (!controlTarget || busy) && styles.disabled]}
        onPress={() => Alert.alert("关闭电脑上的桌面端？", "将强制结束当前连接电脑的 Codex 桌面端及其后台进程，中断正在执行的任务。手机服务会继续运行。", [
          { text: "取消", style: "cancel" },
          { text: "关闭桌面端", style: "destructive", onPress: () => void execute("stop") },
        ])}
      >
        {busy === "stop" ? <ActivityIndicator color={color("#2454d6")} /> : <Ionicons name="power-outline" size={18} color={color("#2454d6")} />}
        <Text style={styles.buttonText}>{busy === "stop" ? "正在关闭…" : "关闭桌面端"}</Text>
      </Pressable>
      <Text style={styles.description}>重启手机连接的 App Server，会中断该服务上正在执行的任务，并短暂断开手机连接。完成后自动重新连接。</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !controlTarget || Boolean(busy), busy: busy === "restart" }}
        disabled={!controlTarget || Boolean(busy)}
        style={[styles.button, (!controlTarget || busy) && styles.disabled]}
        onPress={() => Alert.alert("重启 App Server？", "将中断当前电脑 App Server 上正在执行的任务，手机会短暂断开并重新连接。Relay 和公网通道会保持运行。", [
          { text: "取消", style: "cancel" },
          { text: "重启服务", style: "destructive", onPress: () => void execute("restart") },
        ])}
      >
        {busy === "restart" ? <ActivityIndicator color={color("#2454d6")} /> : <Ionicons name="refresh-outline" size={18} color={color("#2454d6")} />}
        <Text style={styles.buttonText}>{busy === "restart" ? "正在重启…" : "重启 App Server"}</Text>
      </Pressable>
      {!controlTarget ? <Text style={styles.description}>请先在连接页填写电脑的 Relay 地址和 token 并点击连接；连接失败后仍可在此重启服务。</Text> : null}
      {result ? <Text accessibilityLiveRegion="polite" style={result.ok ? styles.success : styles.error}>{result.message}</Text> : null}
    </View>
  );
}

const useStyles = createThemedStyles({
  panel: { backgroundColor: "#ffffff", borderColor: "#e2e8f0", borderRadius: 16, borderWidth: 1, gap: 12, padding: 14 },
  title: { color: "#182230", fontSize: 16, fontWeight: "700" },
  description: { color: "#697789", fontSize: 12, lineHeight: 18 },
  button: { alignItems: "center", backgroundColor: "#edf3ff", borderRadius: 10, flexDirection: "row", gap: 8, justifyContent: "center", padding: 12 },
  buttonText: { color: "#2454d6", fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  success: { color: "#19663b", fontSize: 12, lineHeight: 18 },
  error: { color: "#b42318", fontSize: 12, lineHeight: 18 },
});
