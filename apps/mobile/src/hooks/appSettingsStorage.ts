import * as SecureStore from "expo-secure-store";

const AUTO_ROTATE_KEY = "codexRemote.autoRotate";
const NIGHT_MODE_KEY = "codexRemote.nightMode";

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

export async function loadNightModePreference(): Promise<boolean> {
  if (!(await SecureStore.isAvailableAsync())) {
    return false;
  }
  return (await SecureStore.getItemAsync(NIGHT_MODE_KEY)) === "true";
}

export async function saveNightModePreference(enabled: boolean): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error("SecureStore is unavailable");
  }
  await SecureStore.setItemAsync(NIGHT_MODE_KEY, String(enabled));
}
