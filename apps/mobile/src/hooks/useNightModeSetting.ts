import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";

import { loadNightModePreference, saveNightModePreference } from "./appSettingsStorage";

export type NightModeSettingController = {
  enabled: boolean;
  isReady: boolean;
  isUpdating: boolean;
  setEnabled: (enabled: boolean) => void;
};

export function useNightModeSetting(): NightModeSettingController {
  const [enabled, setEnabledState] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const updateInProgressRef = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const saved = await loadNightModePreference();
        if (active) {
          setEnabledState(saved);
        }
      } catch (error) {
        console.warn("failed to restore night mode preference", error);
      } finally {
        if (active) {
          setIsReady(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const setEnabled = useCallback((nextEnabled: boolean) => {
    if (!isReady || updateInProgressRef.current) {
      return;
    }
    updateInProgressRef.current = true;
    setIsUpdating(true);
    setEnabledState(nextEnabled);
    void (async () => {
      try {
        await saveNightModePreference(nextEnabled);
      } catch (error) {
        setEnabledState(!nextEnabled);
        console.warn("failed to save night mode preference", error);
        Alert.alert("设置保存失败", "请稍后重试。");
      } finally {
        updateInProgressRef.current = false;
        setIsUpdating(false);
      }
    })();
  }, [isReady]);

  return { enabled, isReady, isUpdating, setEnabled };
}
