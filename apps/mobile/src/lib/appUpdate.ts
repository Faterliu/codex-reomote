import appConfig from "../../app.json";

export const APP_UPDATE_MANIFEST_URL = appConfig.expo.extra.appUpdateManifestUrl.trim();

export type AppUpdateManifest = {
  packageName: string;
  versionCode: number;
  versionName: string;
  apkUrl: string;
  sha256: string;
  fileSize?: number;
  forceUpdate: boolean;
  minSupportedVersionCode?: number;
  changelog: string[];
};

export async function fetchAppUpdateManifest(manifestUrl: string, packageName: string) {
  const response = await fetch(manifestUrl, {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(`更新服务器返回 HTTP ${response.status}`);
  }

  return parseAppUpdateManifest(await response.json(), packageName);
}

export function parseAppUpdateManifest(value: unknown, installedPackageName: string): AppUpdateManifest {
  if (!isRecord(value)) {
    throw new Error("更新清单格式无效");
  }

  const packageName = readString(value.packageName);
  const versionName = readString(value.versionName);
  const apkUrl = readString(value.apkUrl);
  const sha256 = readString(value.sha256).toLowerCase();
  const versionCode = value.versionCode;
  const fileSize = value.fileSize;
  const minSupportedVersionCode = value.minSupportedVersionCode;

  if (!packageName || packageName !== installedPackageName) {
    throw new Error("更新包的应用标识与当前安装应用不匹配");
  }
  if (!Number.isSafeInteger(versionCode) || (versionCode as number) <= 0 || !versionName) {
    throw new Error("更新清单缺少有效的版本号");
  }
  if (!/^https:\/\//i.test(apkUrl)) {
    throw new Error("APK 下载地址必须使用 HTTPS");
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("更新清单缺少有效的 SHA-256 校验值");
  }
  if (fileSize !== undefined && (!Number.isSafeInteger(fileSize) || (fileSize as number) <= 0)) {
    throw new Error("更新清单中的文件大小无效");
  }
  if (
    minSupportedVersionCode !== undefined &&
    (!Number.isSafeInteger(minSupportedVersionCode) || (minSupportedVersionCode as number) < 0)
  ) {
    throw new Error("更新清单中的最低支持版本无效");
  }

  const changelog = Array.isArray(value.changelog)
    ? value.changelog.filter((item): item is string => typeof item === "string")
    : typeof value.changelog === "string"
      ? value.changelog.split(/\r?\n/)
      : [];

  return {
    packageName,
    versionCode: versionCode as number,
    versionName,
    apkUrl,
    sha256,
    ...(typeof fileSize === "number" ? { fileSize } : {}),
    forceUpdate: value.forceUpdate === true,
    ...(typeof minSupportedVersionCode === "number" ? { minSupportedVersionCode } : {}),
    changelog: changelog.map((line) => line.trim()).filter(Boolean).slice(0, 20),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
