import { StyleSheet, Switch, Text, View } from "react-native";

import type { AutoRotateSettingController } from "@/hooks/useAutoRotateSetting";

type Props = {
  setting: AutoRotateSettingController;
};

export function AutoRotateSettings({ setting }: Props) {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>应用设置</Text>
      <View style={styles.settingRow}>
        <View style={styles.copy}>
          <Text style={styles.label}>自动旋转</Text>
          <Text style={styles.description}>开启后跟随手机方向切换横竖屏；关闭时固定为竖屏。</Text>
        </View>
        <Switch
          accessibilityLabel="自动旋转"
          disabled={!setting.isReady || setting.isUpdating}
          onValueChange={setting.setEnabled}
          thumbColor="#ffffff"
          trackColor={{ false: "#cbd5e1", true: "#2454d6" }}
          value={setting.enabled}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  title: {
    color: "#182230",
    fontSize: 16,
    fontWeight: "700",
  },
  settingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  label: {
    color: "#182230",
    fontSize: 14,
    fontWeight: "700",
  },
  description: {
    color: "#697789",
    fontSize: 12,
    lineHeight: 17,
  },
});
