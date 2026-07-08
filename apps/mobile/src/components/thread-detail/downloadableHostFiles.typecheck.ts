import { extractDownloadableHostFilePaths } from "./downloadableHostFiles";

const releaseApkPath = "/Users/ningjiangzhu/Workspace/app-codexapp/apps/mobile/android/app/build/outputs/apk/release/app-release.apk";
const detectedPaths = extractDownloadableHostFilePaths(`APK path: ${releaseApkPath}`);

detectedPaths[0] satisfies string | undefined;

if (detectedPaths[0] !== releaseApkPath) {
  throw new Error("release APK path should be detected as a downloadable host file");
}

