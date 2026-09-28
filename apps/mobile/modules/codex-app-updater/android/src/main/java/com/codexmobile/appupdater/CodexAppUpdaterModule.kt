package com.codexmobile.appupdater

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Coroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

class CodexAppUpdaterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CodexAppUpdater")

    Function("getInstalledAppInfo") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("Android app context is unavailable")
      @Suppress("DEPRECATION")
      val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
      val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        packageInfo.longVersionCode
      } else {
        @Suppress("DEPRECATION")
        packageInfo.versionCode.toLong()
      }
      val canRequestPackageInstalls = Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
        context.packageManager.canRequestPackageInstalls()

      mapOf(
        "packageName" to packageInfo.packageName,
        "versionCode" to versionCode,
        "versionName" to (packageInfo.versionName ?: ""),
        "canRequestPackageInstalls" to canRequestPackageInstalls,
      )
    }

    AsyncFunction("getFileSha256") Coroutine { fileUri: String ->
      withContext(Dispatchers.IO) {
        val filePath = Uri.parse(fileUri).path
          ?: throw IllegalArgumentException("APK file path is invalid")
        val apkFile = File(filePath)
        if (!apkFile.isFile) {
          throw IllegalArgumentException("APK file does not exist")
        }

        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(apkFile).use { input ->
          val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            digest.update(buffer, 0, count)
          }
        }

        digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
      }
    }

    AsyncFunction("installApk") { contentUri: String ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("Android app context is unavailable")
      val activity = appContext.currentActivity

      // Android 8.0 起，用户必须为当前应用单独允许安装外部 APK。
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        !context.packageManager.canRequestPackageInstalls()
      ) {
        val settingsIntent = Intent(
          Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:${context.packageName}"),
        )
        if (activity != null) {
          activity.startActivity(settingsIntent)
        } else {
          context.startActivity(settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        return@AsyncFunction "permission_required"
      }

      val installerIntent = Intent(Intent.ACTION_VIEW)
        .setDataAndType(Uri.parse(contentUri), "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

      if (activity != null) {
        activity.startActivity(installerIntent)
      } else {
        context.startActivity(installerIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }

      "installer_opened"
    }
  }
}
