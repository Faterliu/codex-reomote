import type { NormalizedConnection } from "./types";

export function buildDesktopStopRequest(connection: NormalizedConnection) {
  return buildControlRequest(connection, "/desktop/stop");
}

export function buildAppServerRestartRequest(connection: NormalizedConnection) {
  return buildControlRequest(connection, "/app-server/restart");
}

export function getProcessControlTarget(connection: NormalizedConnection | null): string | null {
  if (!connection) return null;
  try {
    return new URL(buildDesktopStopRequest(connection).url).host;
  } catch {
    return null;
  }
}

function buildControlRequest(connection: NormalizedConnection, endpoint: string) {
  const url = new URL(connection.socketUrl);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("连接地址不支持进程控制。");
  const token = url.searchParams.get("relay_token");
  if (!token) throw new Error("请使用带 Relay token 的连接控制进程。");
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = endpoint;
  // HTTP 使用 Authorization，清掉 query，避免把 token 写入代理访问日志。
  url.search = "";
  url.hash = "";
  return { url: url.toString(), headers: { Authorization: `Bearer ${token}` } };
}

export async function requestDesktopStop(connection: NormalizedConnection): Promise<string> {
  return requestControl(buildDesktopStopRequest(connection), "关闭桌面端", "请检查桌面端是否已退出后再试。");
}

export async function requestAppServerRestart(connection: NormalizedConnection): Promise<string> {
  return requestControl(buildAppServerRestartRequest(connection), "重启 App Server", "请检查电脑端服务状态后再试。");
}

async function requestControl(request: ReturnType<typeof buildControlRequest>, action: string, timeoutHint: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 65_000);
  try {
    const response = await fetch(request.url, { method: "POST", headers: request.headers, signal: controller.signal });
    if (response.status === 404) throw new Error("电脑端 Relay 尚未支持此功能，请更新并重启 Relay。");
    const result = await response.json() as { ok?: boolean; message?: string };
    if (!response.ok || result.ok !== true) throw new Error(result.message || `${action}失败。`);
    return result.message || `${action}成功，请重新打开原对话。`;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${action}请求超时，${timeoutHint}`);
    if (error instanceof TypeError) throw new Error("无法访问 Relay，请检查电脑端 Relay 和公网通道。");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
