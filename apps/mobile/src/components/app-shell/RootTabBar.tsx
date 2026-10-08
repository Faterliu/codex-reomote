import { createThemedStyles, useAppTheme } from "@/theme/AppTheme";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

export type RootTab = "connection" | "threads" | "settings";

type Props = {
  activeTab: RootTab;
  onChange: (tab: RootTab) => void;
};

export function RootTabBar({ activeTab, onChange }: Props) {
  const styles = useStyles();
  return (
    <View style={styles.tabBar}>
      <TabButton
        active={activeTab === "connection"}
        activeIcon="link"
        icon="link-outline"
        label="链接"
        onPress={() => onChange("connection")}
      />
      <TabButton
        active={activeTab === "threads"}
        activeIcon="chatbubbles"
        icon="chatbubbles-outline"
        label="会话"
        onPress={() => onChange("threads")}
      />
      <TabButton
        active={activeTab === "settings"}
        activeIcon="settings"
        icon="settings-outline"
        label="设置"
        onPress={() => onChange("settings")}
      />
    </View>
  );
}

function TabButton({
  active,
  activeIcon,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  activeIcon: "link" | "chatbubbles" | "settings";
  icon: "link-outline" | "chatbubbles-outline" | "settings-outline";
  label: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  const { color: themeColor } = useAppTheme();
  const color = active ? "#2454d6" : "#8a94a6";

  return (
    <Pressable onPress={onPress} style={styles.tabItem}>
      <Ionicons color={themeColor(color)} name={active ? activeIcon : icon} size={22} />
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
      <View style={[styles.tabIndicator, active && styles.tabIndicatorActive]} />
    </Pressable>
  );
}

const useStyles = createThemedStyles({
  tabBar: {
    backgroundColor: "#ffffff",
    borderTopColor: "#d8dee8",
    borderTopWidth: 1,
    flexDirection: "row",
    minHeight: 58,
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  tabItem: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    flex: 1,
    gap: 3,
    justifyContent: "center",
    paddingVertical: 8,
  },
  tabText: {
    color: "#516071",
    fontSize: 12,
    fontWeight: "800",
  },
  tabTextActive: {
    color: "#2454d6",
  },
  tabIndicator: {
    backgroundColor: "transparent",
    borderRadius: 999,
    height: 3,
    width: 18,
  },
  tabIndicatorActive: {
    backgroundColor: "#2454d6",
  },
});
