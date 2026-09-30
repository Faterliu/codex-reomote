import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";

const CHATGPT_URL = "https://chatgpt.com/";

export function ChatGptWebPanel() {
  const [isOpening, setIsOpening] = useState(false);

  const openChatGpt = async () => {
    if (isOpening) {
      return;
    }

    setIsOpening(true);
    try {
      await Linking.openURL(CHATGPT_URL);
    } catch {
      Alert.alert("无法打开 ChatGPT", "请检查手机浏览器和网络连接后重试。");
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <Ionicons color="#2454d6" name="globe-outline" size={28} />
      </View>
      <Text style={styles.title}>ChatGPT 网页</Text>
      <Text style={styles.description}>在手机浏览器中登录与电脑网页相同的 ChatGPT 账号，继续查看和使用该账号的对话。</Text>
      <Pressable
        accessibilityRole="button"
        disabled={isOpening}
        onPress={() => void openChatGpt()}
        style={[styles.button, isOpening && styles.buttonDisabled]}
      >
        <Text style={styles.buttonText}>{isOpening ? "正在打开…" : "打开 ChatGPT 网页"}</Text>
        <Ionicons color="#ffffff" name="open-outline" size={18} />
      </Pressable>
      <Text style={styles.hint}>网页将在手机浏览器中打开。</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "flex-start",
    backgroundColor: "#ffffff",
    borderColor: "#d8dee8",
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    padding: 20,
  },
  iconWrap: {
    alignItems: "center",
    backgroundColor: "#edf3ff",
    borderRadius: 14,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  title: {
    color: "#121a26",
    fontSize: 20,
    fontWeight: "800",
  },
  description: {
    color: "#516071",
    fontSize: 14,
    lineHeight: 22,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#2454d6",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
    width: "100%",
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
  },
  hint: {
    color: "#6b7687",
    fontSize: 12,
    lineHeight: 18,
  },
});
