export type InstalledAppInfo = {
  packageName: string;
  versionCode: number;
  versionName: string;
  canRequestPackageInstalls: boolean;
};

export type InstallApkResult = "permission_required" | "installer_opened";

