import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { requireOptionalNativeModule } from "expo";

import { APP_UPDATE_MANIFEST_URL, fetchAppUpdateManifest, type AppUpdateManifest } from "@/lib/appUpdate";
import type { InstalledAppInfo, InstallApkResult } from "../../modules/codex-app-updater";

type AppUpdaterNativeModule = {
  getInstalledAppInfo(): Promise<InstalledAppInfo>;
  getFileSha256(fileUri: string): Promise<string>;
  installApk(contentUri: string): Promise<InstallApkResult>;
};

const nativeUpdater = Platform.OS === "android"
  ? requireOptionalNativeModule<AppUpdaterNativeModule>("CodexAppUpdater")
  : null;

export type AppUpdaterController = {
  update: AppUpdateManifest | null;
  status: "available" | "downloading" | "permission_required" | "installer_opened" | "error" | null;
  progress: number | null;
  error: string | null;
  isCheckingForUpdate: boolean;
  checkForUpdate(): Promise<boolean>;
  installOrDownload(): Promise<void>;
  dismiss(): void;
};

export function useAppUpdater(): AppUpdaterController {
  const [update, setUpdate] = useState<AppUpdateManifest | null>(null);
  const [status, setStatus] = useState<AppUpdaterController["status"]>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCheckingForUpdate, setIsCheckingForUpdate] = useState(false);
  const downloadedApkUriRef = useRef<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    if (Platform.OS !== "android" || !nativeUpdater || !APP_UPDATE_MANIFEST_URL) {
      throw new Error("当前平台或应用构建不支持检查更新。");
    }

    setIsCheckingForUpdate(true);
    try {
      const installed = await nativeUpdater.getInstalledAppInfo();
      const manifest = await fetchAppUpdateManifest(APP_UPDATE_MANIFEST_URL, installed.packageName);
      if (manifest.versionCode <= installed.versionCode) {
        setUpdate(null);
        setStatus(null);
        setProgress(null);
        setError(null);
        downloadedApkUriRef.current = null;
        return false;
      }

      setUpdate({
        ...manifest,
        forceUpdate: manifest.forceUpdate ||
          (manifest.minSupportedVersionCode !== undefined &&
            installed.versionCode < manifest.minSupportedVersionCode),
      });
      setStatus("available");
      setProgress(null);
      setError(null);
      downloadedApkUriRef.current = null;
      return true;
    } finally {
      setIsCheckingForUpdate(false);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android" || !nativeUpdater || !APP_UPDATE_MANIFEST_URL) {
      return;
    }

    let cancelled = false;

    const checkForUpdate = async () => {
      try {
        const installed = await nativeUpdater.getInstalledAppInfo();
        const manifest = await fetchAppUpdateManifest(APP_UPDATE_MANIFEST_URL, installed.packageName);

        if (!cancelled && manifest.versionCode > installed.versionCode) {
          setUpdate({
            ...manifest,
            forceUpdate: manifest.forceUpdate ||
              (manifest.minSupportedVersionCode !== undefined &&
                installed.versionCode < manifest.minSupportedVersionCode),
          });
          setStatus("available");
        }
      } catch (checkError) {
        console.warn("app update check failed", checkError);
      }
    };

    void checkForUpdate();
    return () => {
      cancelled = true;
    };
  }, []);

  const startInstaller = useCallback(async (fileUri: string) => {
    if (!nativeUpdater) {
      throw new Error("当前 Android 安装模块不可用，请重新构建并安装应用。");
    }

    const contentUri = await FileSystem.getContentUriAsync(fileUri);
    const result = await nativeUpdater.installApk(contentUri);
    setStatus(result === "permission_required" ? "permission_required" : "installer_opened");
  }, []);

  const installOrDownload = useCallback(async () => {
    if (!update) {
      return;
    }

    if (downloadedApkUriRef.current) {
      setError(null);
      try {
        await startInstaller(downloadedApkUriRef.current);
      } catch (installError) {
        setError(toErrorMessage(installError));
        setStatus("error");
      }
      return;
    }

    if (!nativeUpdater) {
      setError("当前 Android 安装模块不可用，请重新构建并安装应用。");
      setStatus("error");
      return;
    }

    setStatus("downloading");
    setProgress(0);
    setError(null);

    try {
      const downloadRoot = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!downloadRoot) {
        throw new Error("手机存储目录不可用，无法下载更新包。");
      }

      const downloadDirectory = `${downloadRoot}app-update/`;
      await FileSystem.makeDirectoryAsync(downloadDirectory, { intermediates: true });
      const destination = `${downloadDirectory}codex-mobile-update.apk`;
      const existingFile = await FileSystem.getInfoAsync(destination);
      if (existingFile.exists) {
        await FileSystem.deleteAsync(destination, { idempotent: true });
      }

      const task = FileSystem.createDownloadResumable(
        update.apkUrl,
        destination,
        { headers: { Accept: "application/vnd.android.package-archive" } },
        (downloadProgress) => {
          if (downloadProgress.totalBytesExpectedToWrite > 0) {
            setProgress(Math.min(100, Math.round(
              (downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100,
            )));
          }
        },
      );
      const result = await task.downloadAsync();

      if (!result || result.status < 200 || result.status >= 300) {
        throw new Error(`APK 下载失败${result ? `（HTTP ${result.status}）` : ""}`);
      }

      const downloadedFile = await FileSystem.getInfoAsync(result.uri);
      if (!downloadedFile.exists || downloadedFile.isDirectory) {
        throw new Error("APK 下载完成，但文件不可用。");
      }
      if (update.fileSize !== undefined && downloadedFile.size !== update.fileSize) {
        throw new Error("下载文件大小与服务器清单不一致，已取消安装。");
      }

      const actualSha256 = await nativeUpdater.getFileSha256(result.uri);
      if (actualSha256.toLowerCase() !== update.sha256) {
        await FileSystem.deleteAsync(result.uri, { idempotent: true });
        throw new Error("APK SHA-256 校验失败，已取消安装。");
      }

      downloadedApkUriRef.current = result.uri;
      setProgress(100);
      await startInstaller(result.uri);
    } catch (downloadError) {
      setError(toErrorMessage(downloadError));
      setStatus("error");
    }
  }, [startInstaller, update]);

  const dismiss = useCallback(() => {
    if (update?.forceUpdate) {
      return;
    }
    setUpdate(null);
    setStatus(null);
    setProgress(null);
    setError(null);
    downloadedApkUriRef.current = null;
  }, [update]);

  return { update, status, progress, error, isCheckingForUpdate, checkForUpdate, installOrDownload, dismiss };
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "更新失败，请检查网络后重试。";
}
