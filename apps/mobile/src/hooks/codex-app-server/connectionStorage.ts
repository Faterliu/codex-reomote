import * as SecureStore from "expo-secure-store";

export type SavedConnectionConfig = {
  url: string;
  token: string;
};

const STORAGE_URL_KEY = "codexRemote.appServerUrl";
const STORAGE_TOKEN_KEY = "codexRemote.appServerToken";

export const DEFAULT_APP_SERVER_URL = "wss://your-domain.example.com";

export async function loadSavedConnectionConfig(): Promise<SavedConnectionConfig | null> {
  const available = await SecureStore.isAvailableAsync();
  if (!available) {
    return null;
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

  // token 属于敏感配置，必须写入 SecureStore，避免落到普通本地存储。
  await SecureStore.setItemAsync(STORAGE_URL_KEY, config.url.trim());
  if (config.token.trim()) {
    await SecureStore.setItemAsync(STORAGE_TOKEN_KEY, config.token.trim());
  } else {
    await SecureStore.deleteItemAsync(STORAGE_TOKEN_KEY);
  }

  return "saved";
}

export async function clearSavedConnectionConfig(): Promise<"cleared" | "unavailable"> {
  const available = await SecureStore.isAvailableAsync();
  if (!available) {
    return "unavailable";
  }

  await Promise.all([SecureStore.deleteItemAsync(STORAGE_URL_KEY), SecureStore.deleteItemAsync(STORAGE_TOKEN_KEY)]);
  return "cleared";
}
