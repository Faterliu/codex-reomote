import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function runControlScript(scriptName, args) {
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = fileURLToPath(new URL(scriptName, import.meta.url));
  // 只允许固定脚本和本机端口，不把手机输入拼接到 shell 命令中。
  // 重启脚本会启动长期后台进程；忽略输出管道，防止继承句柄使 execFile 一直等不到 EOF。
  await new Promise((resolve, reject) => {
    const child = spawn(powershell, [
      "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args,
    ], { windowsHide: true, stdio: "ignore" });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Control script timed out"));
    }, 60_000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(); else reject(new Error(`Control script exited with code ${code}`));
    });
  });
}

export function stopCodexDesktop({ appServerPort, relayPort }) {
  return runControlScript("./stop-codex-desktop.ps1", ["-AppServerPort", String(appServerPort), "-RelayPort", String(relayPort)]);
}

export function restartPhoneAppServer({ appServerPort, relayPort, tokenFile }) {
  return runControlScript("./restart-phone-tunnel.ps1", [
    "-LocalOnly", "-AppServerPort", String(appServerPort), "-RelayPort", String(relayPort), "-AppServerTokenFile", tokenFile,
  ]);
}

export function createProcessControlHandlers({ relayToken, appServerPort, relayPort, tokenFile, canRestart = true, platform = process.platform, stop = stopCodexDesktop, restart = restartPhoneAppServer }) {
  let running = false;
  const handler = (action, execute, success, failure) => async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      reply(405, { ok: false, message: "请使用 POST 执行控制操作。" });
      return;
    }
    // WebSocket 可配置成无 token；远程进程控制始终要求配置并校验 token。
    if (!relayToken) {
      reply(503, { ok: false, message: "本机 Relay 未配置 token，无法远程控制进程。" });
      return;
    }
    const provided = Buffer.from(/^Bearer (.+)$/i.exec(String(req.headers.authorization || ""))?.[1] || "");
    const expected = Buffer.from(relayToken);
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      reply(403, { ok: false, message: "Relay token 不正确，未执行操作。" });
      return;
    }
    if (platform !== "win32") {
      reply(501, { ok: false, message: "当前功能仅支持 Windows。" });
      return;
    }
    if (action === "restart" && !canRestart) {
      reply(501, { ok: false, message: "仅支持重启本机 WebSocket App Server，当前连接方式不支持重启。" });
      return;
    }
    if (running) {
      reply(409, { ok: false, message: "另一项进程控制操作正在执行，请稍后再试。" });
      return;
    }
    running = true;
    try {
      await execute(action === "restart" ? { appServerPort, relayPort, tokenFile } : { appServerPort, relayPort });
      reply(200, { ok: true, message: success });
    } catch {
      reply(500, { ok: false, message: failure });
    } finally {
      running = false;
    }
  };
  return {
    stopDesktop: handler("stop", stop, "桌面端已关闭。请重新打开原对话继续使用。", "关闭桌面端失败或超时，请检查电脑端进程后再试。"),
    restartAppServer: handler("restart", restart, "App Server 已重启。手机将重新连接，请重新打开原对话。", "重启 App Server 失败或超时，请检查电脑端服务后再试。"),
  };
}

export function createDesktopStopHandler(options) {
  return createProcessControlHandlers(options).stopDesktop;
}
