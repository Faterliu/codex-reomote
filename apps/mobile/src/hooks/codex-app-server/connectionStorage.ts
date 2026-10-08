import * as SecureStore from "expo-secure-store";

export type SavedConnectionConfig = {
  url: string;
  token: string;
};

const STORAGE_URL_KEY = "codexRemote.appServerUrl";
const STORAGE_TOKEN_KEY = "codexRemote.appServerToken";
const STORAGE_CONFIG_KEY = "codexRemote.lastConnection.v1";

export const DEFAULT_APP_SERVER_URL = "wss://your-domain.example.com";

export async function loadSavedConnectionConfig(): Promise<SavedConnectionConfig | null> {
  const available = await SecureStore.isAvailableAsync();
  if (!available) {
    return null;
  }

  const savedConfig = await SecureStore.getItemAsync(STORAGE_CONFIG_KEY);
  if (savedConfig !== null) {
    try {
      const config: unknown = JSON.parse(savedConfig);
      if (config && typeof config === "object" && "url" in config && typeof config.url === "string"
        && "token" in config && typeof config.token === "string") {
        return { url: config.url, token: config.token };
      }
    } catch {
      // 不回显原始凭据，也不把损坏记录误当成空配置覆盖。
    }
    throw new Error("保存的连接配置读取失败");
  }

  const [savedUrl, savedToken] = await Promise.all([
    SecureStore.getItemAsync(STORAGE_URL_KEY),
    SecureStore.getItemAsync(STORAGE_TOKEN_KEY),
  ]);

  if (!savedUrl && !savedToken) {
    return null;
  }

  return {
    url: savedUrl || "",
    token: savedToken || "",
  };
}

export async function saveConnectionConfig(config: SavedConnectionConfig): Promise<"saved" | "unavailable"> {
  const available = await SecureStore.isAvailableAsync();
  if (!available) {
    return "unavailable";
  }

  // 网址与 token 在安全存储中一次写入，避免换账号时部分写入导致凭据配错。
  await SecureStore.setItemAsync(STORAGE_CONFIG_KEY, JSON.stringify({ url: config.url.trim(), token: config.token.trim() }));

  return "saved";
}

export async function clearSavedConnectionConfig(): Promise<"cleared" | "unavailable"> {
  const available = await SecureStore.isAvailableAsync();
  if (!available) {
    return "unavailable";
  }

  await Promise.all([
    SecureStore.deleteItemAsync(STORAGE_CONFIG_KEY),
    SecureStore.deleteItemAsync(STORAGE_URL_KEY),
    SecureStore.deleteItemAsync(STORAGE_TOKEN_KEY),
  ]);
  return "cleared";
}
