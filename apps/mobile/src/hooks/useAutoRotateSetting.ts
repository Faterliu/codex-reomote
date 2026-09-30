import { useCallback, useEffect, useRef, useState } from "react";
import * as ScreenOrientation from "expo-screen-orientation";

import { loadAutoRotatePreference, saveAutoRotatePreference } from "./appSettingsStorage";

export type AutoRotateSettingController = {
  enabled: boolean;
  isReady: boolean;
  isUpdating: boolean;
  setEnabled: (enabled: boolean) => void;
};

export function useAutoRotateSetting(): AutoRotateSettingController {
  const [enabled, setEnabledState] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const updateInProgressRef = useRef(false);

  useEffect(() => {
    let active = true;

    const restorePreference = async () => {
      // 先落实默认竖屏，再恢复用户上次保存的选择。
      await applyScreenOrientation(false);

      let savedEnabled = false;
      try {
        savedEnabled = await loadAutoRotatePreference();
      } catch (error) {
        console.warn("failed to restore auto-rotate preference", error);
      }

      if (!active) {
        return;
      }

      setEnabledState(savedEnabled);
      if (savedEnabled) {
        await applyScreenOrientation(true);
      }
      if (active) {
        setIsReady(true);
      }
    };

    void restorePreference();

    return () => {
      active = false;
    };
  }, []);

  const setEnabled = useCallback(
    (nextEnabled: boolean) => {
      if (!isReady || updateInProgressRef.current) {
        return;
      }

      updateInProgressRef.current = true;
      setIsUpdating(true);
      setEnabledState(nextEnabled);

      void (async () => {
        try {
          await applyScreenOrientation(nextEnabled);
          await saveAutoRotatePreference(nextEnabled);
        } catch (error) {
          console.warn("failed to save auto-rotate preference", error);
        } finally {
          updateInProgressRef.current = false;
          setIsUpdating(false);
        }
      })();
    },
    [isReady],
  );

  return { enabled, isReady, isUpdating, setEnabled };
}

async function applyScreenOrientation(autoRotate: boolean): Promise<void> {
  try {
    if (autoRotate) {
      await ScreenOrientation.unlockAsync();
    } else {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    }
  } catch (error) {
    // 某些设备或运行环境不支持方向控制时，保留当前方向并继续运行。
    console.warn("failed to apply screen orientation", error);
  }
}
