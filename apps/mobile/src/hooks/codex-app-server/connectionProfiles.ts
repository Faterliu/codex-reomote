import * as SecureStore from "expo-secure-store";

import { clearSavedConnectionConfig, loadSavedConnectionConfig, saveConnectionConfig, type SavedConnectionConfig } from "./connectionStorage";

export type ConnectionProfile = SavedConnectionConfig & { id: string; name: string };
export type ConnectionProfileInput = SavedConnectionConfig & { id?: string; name: string };

const INDEX_KEY = "codexRemote.connectionProfiles.v1";
const PROFILE_PREFIX = "codexRemote.connectionProfile.";
const LEGACY_PROFILE_ID = "legacy";

export function normalizeProfileConfig(config: SavedConnectionConfig): SavedConnectionConfig {
  let parsed: URL;
  try {
    parsed = new URL(config.url.trim());
  } catch {
    throw new Error("请填写有效的 ws:// 或 wss:// 连接网址");
  }
  if ((parsed.protocol !== "ws:" && parsed.protocol !== "wss:") || !parsed.hostname) {
    throw new Error("连接网址必须以 ws:// 或 wss:// 开头");
  }
  // 将完整连接链接中的 token 移到安全字段，账号列表里的网址不显示凭据。
  const token = config.token.trim() || parsed.searchParams.get("relay_token") || "";
  parsed.searchParams.delete("relay_token");
  if (parsed.username || parsed.password) {
    throw new Error("请将连接凭据填写在 Relay token 中");
  }
  return { url: parsed.toString(), token };
}

async function readIds(): Promise<string[] | null> {
  const raw = await SecureStore.getItemAsync(INDEX_KEY);
  if (raw === null) return null;
  try {
    const ids: unknown = JSON.parse(raw);
    if (Array.isArray(ids) && ids.every((id) => typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id))) {
      return [...new Set(ids)] as string[];
    }
  } catch {
    // 不把原始存储内容附在错误里，避免泄漏凭据。
  }
  throw new Error("账号列表读取失败，请重试");
}

async function readProfile(id: string): Promise<ConnectionProfile | null> {
  const raw = await SecureStore.getItemAsync(PROFILE_PREFIX + id);
  if (raw === null) return null;
  try {
    const profile: unknown = JSON.parse(raw);
    if (profile && typeof profile === "object" && "name" in profile && typeof profile.name === "string"
      && "url" in profile && typeof profile.url === "string" && "token" in profile && typeof profile.token === "string") {
      return { id, name: profile.name, ...normalizeProfileConfig({ url: profile.url, token: profile.token }) };
    }
  } catch {
    // 对损坏记录报错，不能将其当成空列表覆盖。
  }
  throw new Error("账号记录读取失败，请重试");
}

async function ensureIds(): Promise<string[]> {
  const ids = await readIds();
  if (ids !== null) return ids;
  const legacy = await loadSavedConnectionConfig();
  const migratedIds: string[] = [];
  if (legacy?.url.trim()) {
    const profile: ConnectionProfile = { id: LEGACY_PROFILE_ID, name: "默认账号", ...normalizeProfileConfig(legacy) };
    // 固定迁移 ID，使中途写入失败后的重试不会产生重复账号；原连接配置继续保留。
    await SecureStore.setItemAsync(PROFILE_PREFIX + profile.id, JSON.stringify(profile));
    migratedIds.push(profile.id);
  }
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(migratedIds));
  return migratedIds;
}

export async function loadConnectionProfiles(): Promise<ConnectionProfile[] | null> {
  if (!(await SecureStore.isAvailableAsync())) return null;
  const ids = await ensureIds();
  const profiles = await Promise.all(ids.map(readProfile));
  return profiles.filter((profile): profile is ConnectionProfile => profile !== null);
}

export async function saveConnectionProfile(input: ConnectionProfileInput): Promise<ConnectionProfile | null> {
  const name = input.name.trim();
  if (!name) throw new Error("请填写账号名称");
  const config = normalizeProfileConfig(input);
  if (!(await SecureStore.isAvailableAsync())) return null;
  const ids = await ensureIds();
  if (input.id && !ids.includes(input.id)) throw new Error("账号已删除，请重新添加");
  const previous = input.id ? await readProfile(input.id) : null;
  const saved = previous ? await loadSavedConnectionConfig() : null;
  const normalizedSaved = saved ? normalizeProfileConfig(saved) : null;
  const updatesLastConnection = previous && normalizedSaved
    && previous.url === normalizedSaved.url && previous.token === normalizedSaved.token;
  const id = input.id || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  const profile: ConnectionProfile = { id, name, ...config };
  // 每个账号分别存储，避免把多个 token 拼成一个过大的安全存储值。
  await SecureStore.setItemAsync(PROFILE_PREFIX + id, JSON.stringify(profile));
  if (updatesLastConnection) {
    try {
      // 修改上次使用的账号时同步自动连接配置，重启后不再使用旧地址或旧 token。
      await saveConnectionConfig(profile);
    } catch (error) {
      await SecureStore.setItemAsync(PROFILE_PREFIX + id, JSON.stringify(previous));
      throw error;
    }
  }
  if (!ids.includes(id)) {
    try {
      await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify([...ids, id]));
    } catch (error) {
      await SecureStore.deleteItemAsync(PROFILE_PREFIX + id);
      throw error;
    }
  }
  return profile;
}

export async function deleteConnectionProfile(id: string): Promise<boolean> {
  if (!(await SecureStore.isAvailableAsync())) return false;
  const ids = await ensureIds();
  if (!ids.includes(id)) return true;
  const profile = await readProfile(id);
  const saved = await loadSavedConnectionConfig();
  if (profile && saved) {
    const normalizedSaved = normalizeProfileConfig(saved);
    if (profile.url === normalizedSaved.url && profile.token === normalizedSaved.token) {
      await clearSavedConnectionConfig();
    }
  }
  // 先删除凭据，再移除索引；中断后重试仍可完成清理。
  await SecureStore.deleteItemAsync(PROFILE_PREFIX + id);
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(ids.filter((candidate) => candidate !== id)));
  return true;
}
