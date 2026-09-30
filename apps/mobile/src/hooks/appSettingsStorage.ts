import * as SecureStore from "expo-secure-store";

const AUTO_ROTATE_KEY = "codexRemote.autoRotate";

export async function loadAutoRotatePreference(): Promise<boolean> {
  const available = await SecureStore.isAvailableAsync();
  if (!available) {
    return false;
  }

  return (await SecureStore.getItemAsync(AUTO_ROTATE_KEY)) === "true";
}

export async function saveAutoRotatePreference(enabled: boolean): Promise<void> {
  const available = await SecureStore.isAvailableAsync();
  if (!available) {
    throw new Error("SecureStore is unavailable");
  }

  await SecureStore.setItemAsync(AUTO_ROTATE_KEY, String(enabled));
}
