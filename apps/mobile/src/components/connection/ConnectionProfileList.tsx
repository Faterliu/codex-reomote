import { Ionicons } from "@expo/vector-icons";
import { Alert, Pressable, Text, View } from "react-native";

import type { ConnectionProfile } from "@/hooks/codex-app-server/connectionProfiles";
import { createThemedStyles, useAppTheme } from "@/theme/AppTheme";

type Props = {
  profiles: ConnectionProfile[];
  selectedId: string | null;
  disabled: boolean;
  isLoading: boolean;
  onSelect: (profile: ConnectionProfile) => void;
  onCreate: () => void;
  onDelete: (profile: ConnectionProfile) => void;
};

export function ConnectionProfileList({ profiles, selectedId, disabled, isLoading, onSelect, onCreate, onDelete }: Props) {
  const styles = useStyles();
  const { color } = useAppTheme();
  return (
    <View style={styles.list}>
      <View style={styles.header}>
        <Text style={styles.title}>账号记录 ({profiles.length})</Text>
        <Pressable accessibilityRole="button" disabled={disabled} onPress={onCreate} style={[styles.addButton, disabled && styles.disabled]}>
          <Ionicons name="add-outline" size={18} color={color("#2454d6")} />
          <Text style={styles.addText}>新增账号</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>点击账号可查看或修改网址与 token，选中后点连接。</Text>
      {profiles.map((profile) => {
        const selected = profile.id === selectedId;
        return (
          <View key={profile.id} style={[styles.record, selected && styles.selected]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`选择账号 ${profile.name}`}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onSelect(profile)}
              style={styles.selectButton}
            >
              <Ionicons name={selected ? "checkmark-circle" : "person-circle-outline"} size={24} color={color(selected ? "#2454d6" : "#697789")} />
              <View style={styles.copy}>
                <Text numberOfLines={1} style={styles.name}>{profile.name}</Text>
                <Text numberOfLines={1} style={styles.url}>{profile.url}</Text>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`删除账号 ${profile.name}`}
              disabled={disabled}
              onPress={() => Alert.alert("删除账号记录", `删除“${profile.name}”及其保存的 token？当前连接会继续保持。`, [
                { text: "取消", style: "cancel" },
                { text: "删除", style: "destructive", onPress: () => onDelete(profile) },
              ])}
              style={styles.deleteButton}
            >
              <Ionicons name="trash-outline" size={19} color={color("#9b2222")} />
            </Pressable>
          </View>
        );
      })}
      {profiles.length === 0 ? <Text style={styles.hint}>{isLoading ? "正在读取账号…" : "还没有账号记录，点击「新增账号」添加。"}</Text> : null}
    </View>
  );
}

const useStyles = createThemedStyles({
  list: { gap: 8 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: "#182230", fontSize: 14, fontWeight: "700" },
  hint: { color: "#697789", fontSize: 12, lineHeight: 18 },
  addButton: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 8 },
  addText: { color: "#2454d6", fontSize: 12, fontWeight: "700" },
  disabled: { opacity: 0.55 },
  record: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, backgroundColor: "#f8fafc" },
  selected: { borderColor: "#2454d6", backgroundColor: "#edf3ff" },
  selectButton: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, padding: 10, minHeight: 60 },
  copy: { flex: 1, gap: 3 },
  name: { color: "#182230", fontSize: 14, fontWeight: "700" },
  url: { color: "#697789", fontSize: 11 },
  deleteButton: { paddingHorizontal: 14, paddingVertical: 18 },
});
