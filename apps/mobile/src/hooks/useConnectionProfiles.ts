import { useEffect, useRef, useState } from "react";

import { clearSavedConnectionConfig, DEFAULT_APP_SERVER_URL, loadSavedConnectionConfig, saveConnectionConfig } from "./codex-app-server/connectionStorage";
import { deleteConnectionProfile, loadConnectionProfiles, normalizeProfileConfig, saveConnectionProfile, type ConnectionProfile } from "./codex-app-server/connectionProfiles";

export function useConnectionProfiles() {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState(DEFAULT_APP_SERVER_URL);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const busyRef = useRef(false);

  const fillProfile = (profile: ConnectionProfile) => {
    setSelectedId(profile.id);
    setName(profile.name);
    setUrl(profile.url);
    setToken(profile.token);
  };

  const resetForm = () => {
    setSelectedId(null);
    setName("");
    setUrl(DEFAULT_APP_SERVER_URL);
    setToken("");
  };

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const savedProfiles = await loadConnectionProfiles();
        const saved = await loadSavedConnectionConfig();
        if (!mounted) return;
        setProfiles(savedProfiles ?? []);
        if (saved?.url) {
          const normalized = normalizeProfileConfig(saved);
          const profile = savedProfiles?.find((candidate) => candidate.url === normalized.url && candidate.token === normalized.token);
          if (profile) fillProfile(profile);
          else { setUrl(normalized.url); setToken(normalized.token); }
        }
        setStatus(savedProfiles === null ? "当前平台不支持安全保存，可手动连接" : saved ? "已恢复上次使用的连接" : null);
      } catch (error) {
        if (mounted) setStatus(`读取账号失败：${errorMessage(error)}`);
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const runUpdate = async (action: () => Promise<void>) => {
    if (isLoading || busyRef.current) return;
    busyRef.current = true;
    setIsUpdating(true);
    try { await action(); }
    catch (error) { setStatus(errorMessage(error)); }
    finally { busyRef.current = false; setIsUpdating(false); }
  };

  const saveProfile = async () => {
    const profile = await saveConnectionProfile({ id: selectedId ?? undefined, name, url, token });
    if (profile) {
      setProfiles((current) => current.some((candidate) => candidate.id === profile.id)
        ? current.map((candidate) => candidate.id === profile.id ? profile : candidate)
        : [...current, profile]);
      fillProfile(profile);
    }
    return profile;
  };

  const save = () => runUpdate(async () => {
    const profile = await saveProfile();
    setStatus(profile ? `已安全保存账号“${profile.name}”` : "当前平台不支持安全保存");
  });

  const connect = (onConnect: (url: string, token: string) => void) => runUpdate(async () => {
    const config = normalizeProfileConfig({ url, token });
    // 填写名称时同步保存账号；未命名的临时连接仍保留原有使用方式。
    try {
      if (name.trim() || selectedId) await saveProfile();
      const result = await saveConnectionConfig(config);
      setStatus(result === "saved" ? "已记住本次连接，下次启动自动恢复" : "当前平台不支持安全保存，本次直接连接");
    } catch (error) {
      setStatus(`保存失败，本次直接连接：${errorMessage(error)}`);
    }
    onConnect(config.url, config.token);
  });

  const remove = (profile: ConnectionProfile) => runUpdate(async () => {
    if (!(await deleteConnectionProfile(profile.id))) {
      setStatus("当前平台不支持安全保存");
      return;
    }
    setProfiles((current) => current.filter((candidate) => candidate.id !== profile.id));
    if (selectedId === profile.id) resetForm();
    setStatus(`已删除账号“${profile.name}”`);
  });

  const clearLastConnection = () => runUpdate(async () => {
    if ((await clearSavedConnectionConfig()) === "unavailable") {
      setStatus("当前平台不支持安全保存");
      return;
    }
    resetForm();
    setStatus("已清除上次连接，账号记录仍可选择");
  });

  const select = (profile: ConnectionProfile) => {
    if (isLoading || busyRef.current) return;
    fillProfile(profile);
    setStatus(`已载入“${profile.name}”，点击连接使用`);
  };

  const create = () => {
    if (isLoading || busyRef.current) return;
    resetForm();
    setStatus("填写名称、网址和 Relay token 后保存账号");
  };

  const importConfig = (config: { url: string; token: string }) => {
    if (isLoading || busyRef.current) return;
    // 扫码总是作为新账号草稿导入，避免覆盖正在编辑的账号。
    resetForm();
    setUrl(config.url);
    setToken(config.token);
    setStatus("已导入连接配置，填写名称后可保存为新账号");
  };

  return { profiles, selectedId, name, setName, url, setUrl, token, setToken, status, setStatus,
    isBusy: isLoading || isUpdating, isLoading, save, connect, remove, clearLastConnection, select, create, importConfig };
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
