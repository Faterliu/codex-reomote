import { Switch, Text, View } from "react-native";

import type { AutoRotateSettingController } from "@/hooks/useAutoRotateSetting";
import type { NightModeSettingController } from "@/hooks/useNightModeSetting";
import { createThemedStyles } from "@/theme/AppTheme";

import { AutoRotateSettings } from "./AutoRotateSettings";

type Props = {
  autoRotateSetting: AutoRotateSettingController;
  nightModeSetting: NightModeSettingController;
};

export function AppSettingsPanel({ autoRotateSetting, nightModeSetting }: Props) {
  const styles = useStyles();
  return (
    <>
      <AutoRotateSettings setting={autoRotateSetting} />
      <View style={styles.panel}>
        <Text style={styles.title}>外观</Text>
        <View style={styles.settingRow}>
          <View style={styles.copy}>
            <Text style={styles.label}>夜间模式</Text>
            <Text style={styles.description}>开启深色界面，减少夜间使用时的屏幕亮度。</Text>
          </View>
          <Switch
            accessibilityLabel="夜间模式"
            disabled={!nightModeSetting.isReady || nightModeSetting.isUpdating}
            onValueChange={nightModeSetting.setEnabled}
            thumbColor="#ffffff"
            trackColor={{ false: "#64748b", true: "#2454d6" }}
            value={nightModeSetting.enabled}
          />
        </View>
      </View>
    </>
  );
}

const useStyles = createThemedStyles({
  panel: { backgroundColor: "#ffffff", borderColor: "#e2e8f0", borderRadius: 16, borderWidth: 1, gap: 12, padding: 14 },
  title: { color: "#182230", fontSize: 16, fontWeight: "700" },
  settingRow: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  copy: { flex: 1, gap: 4 },
  label: { color: "#182230", fontSize: 14, fontWeight: "700" },
  description: { color: "#697789", fontSize: 12, lineHeight: 17 },
});
