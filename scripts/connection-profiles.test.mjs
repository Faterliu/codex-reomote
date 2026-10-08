import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const indexKey = "codexRemote.connectionProfiles.v1";
const prefix = "codexRemote.connectionProfile.";
const urlKey = "codexRemote.appServerUrl";
const tokenKey = "codexRemote.appServerToken";
const lastConnectionKey = "codexRemote.lastConnection.v1";

// 在内存中替代设备 SecureStore，执行实际 TypeScript 存储模块，不读取本机凭据。
function fixture(initial = {}, available = true) {
  const values = new Map(Object.entries(initial));
  let failKey = null;
  const secureStore = {
    isAvailableAsync: async () => available,
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      if (key === failKey) throw new Error("simulated write failure");
      values.set(key, value);
    },
    deleteItemAsync: async (key) => { values.delete(key); },
  };
  const modules = new Map();
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    const source = readFileSync(new URL(`../apps/mobile/src/hooks/codex-app-server/${name}.ts`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const exports = {};
    vm.runInNewContext(outputText, {
      exports, URL,
      require: (id) => {
        if (id === "expo-secure-store") return secureStore;
        if (id === "./connectionStorage") return load("connectionStorage");
        throw new Error(`Unexpected import: ${id}`);
      },
    }, { filename: `${name}.ts` });
    modules.set(name, exports);
    return exports;
  }
  return {
    api: load("connectionProfiles"), storage: load("connectionStorage"), values,
    failWrites: (key) => { failKey = key; },
  };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test("migrates the previous connection once without deleting its credentials", async () => {
  const { api, values } = fixture({ [urlKey]: "wss://old.example.com", [tokenKey]: "old-token" });
  const profiles = await api.loadConnectionProfiles();
  assert.deepEqual(plain(profiles), [{ id: "legacy", name: "默认账号", url: "wss://old.example.com/", token: "old-token" }]);
  assert.equal((await api.loadConnectionProfiles()).length, 1);
  assert.equal(values.get(tokenKey), "old-token");
});

test("keeps each account URL and token paired across saves, edits and reloads", async () => {
  const { api, values } = fixture();
  const first = await api.saveConnectionProfile({ name: " 家用电脑 ", url: "wss://home.example.com?relay_token=imported", token: "" });
  const second = await api.saveConnectionProfile({ name: "工作电脑", url: "wss://work.example.com", token: " work-token " });
  const edited = await api.saveConnectionProfile({ ...first, name: "家用账号", token: "new-home-token" });
  assert.equal(edited.id, first.id);
  assert.equal(first.url.includes("relay_token"), false);
  const profiles = plain(await api.loadConnectionProfiles());
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0].name, "家用账号");
  assert.equal(profiles[0].token, "new-home-token");
  assert.equal(profiles[1].token, "work-token");
  assert.equal(profiles[1].url, "wss://work.example.com/");
  assert.equal(values.get(indexKey).includes("token"), false);
  assert.ok(values.has(prefix + second.id));
});

test("explicit token overrides a token embedded in the URL; direct ws supports an empty token", () => {
  const { api } = fixture();
  assert.deepEqual(plain(api.normalizeProfileConfig({ url: "wss://host.example.com/path?relay_token=stale&x=1", token: " fresh " })), {
    url: "wss://host.example.com/path?x=1", token: "fresh",
  });
  assert.equal(api.normalizeProfileConfig({ url: "ws://127.0.0.1:4500", token: "" }).token, "");
});

test("editing the last used account updates auto-connect; editing another account preserves it", async () => {
  const { api, storage } = fixture();
  const first = await api.saveConnectionProfile({ name: "A", url: "wss://a.example.com", token: "a-token" });
  const second = await api.saveConnectionProfile({ name: "B", url: "wss://b.example.com", token: "b-token" });
  await storage.saveConnectionConfig(first);
  await api.saveConnectionProfile({ ...second, token: "new-b-token" });
  assert.equal((await storage.loadSavedConnectionConfig()).token, "a-token");
  await api.saveConnectionProfile({ ...first, url: "wss://new-a.example.com", token: "new-a-token" });
  assert.deepEqual(plain(await storage.loadSavedConnectionConfig()), { url: "wss://new-a.example.com/", token: "new-a-token" });
  await api.deleteConnectionProfile(first.id);
  assert.equal(await storage.loadSavedConnectionConfig(), null);
});

test("failed last-connection write keeps the old account and its paired auto-connect credentials", async () => {
  const { api, storage, failWrites } = fixture();
  const profile = await api.saveConnectionProfile({ name: "A", url: "wss://a.example.com", token: "a-token" });
  await storage.saveConnectionConfig(profile);
  failWrites(lastConnectionKey);
  await assert.rejects(api.saveConnectionProfile({ ...profile, url: "wss://new-a.example.com", token: "new-token" }), /simulated/);
  assert.equal((await storage.loadSavedConnectionConfig()).token, "a-token");
  assert.equal((await api.loadConnectionProfiles())[0].token, "a-token");
});

test("deletion removes credentials and matching auto-connect config while preserving other accounts", async () => {
  const { api, storage, values } = fixture();
  const first = await api.saveConnectionProfile({ name: "A", url: "wss://a.example.com", token: "a-token" });
  const second = await api.saveConnectionProfile({ name: "B", url: "wss://b.example.com", token: "b-token" });
  await storage.saveConnectionConfig(first);
  await api.deleteConnectionProfile(second.id);
  assert.equal((await storage.loadSavedConnectionConfig()).token, "a-token");
  await api.deleteConnectionProfile(first.id);
  assert.equal(await storage.loadSavedConnectionConfig(), null);
  assert.equal(values.has(prefix + first.id), false);
  assert.equal(values.has(prefix + second.id), false);
  assert.equal((await api.loadConnectionProfiles()).length, 0);
});

test("a failed index write does not leave a newly saved credential behind", async () => {
  const { api, values, failWrites } = fixture();
  await api.loadConnectionProfiles();
  failWrites(indexKey);
  await assert.rejects(api.saveConnectionProfile({ name: "A", url: "wss://a.example.com", token: "a-token" }), /simulated/);
  assert.equal([...values.keys()].some((key) => key.startsWith(prefix)), false);
  failWrites(null);
  assert.equal((await api.loadConnectionProfiles()).length, 0);
});

test("migration retries use the same record ID after an interrupted index write", async () => {
  const { api, values, failWrites } = fixture({ [urlKey]: "wss://old.example.com", [tokenKey]: "old-token" });
  failWrites(indexKey);
  await assert.rejects(api.loadConnectionProfiles(), /simulated/);
  failWrites(null);
  assert.equal((await api.loadConnectionProfiles()).length, 1);
  assert.equal([...values.keys()].filter((key) => key.startsWith(prefix)).length, 1);
});

test("deletion retries finish an interrupted index update without restoring deleted credentials", async () => {
  const { api, values, failWrites } = fixture();
  const profile = await api.saveConnectionProfile({ name: "A", url: "wss://a.example.com", token: "a-token" });
  failWrites(indexKey);
  await assert.rejects(api.deleteConnectionProfile(profile.id), /simulated/);
  assert.equal(values.has(prefix + profile.id), false);
  assert.equal((await api.loadConnectionProfiles()).length, 0);
  failWrites(null);
  await api.deleteConnectionProfile(profile.id);
  assert.equal(values.get(indexKey), "[]");
});

test("malformed storage fails without overwriting data or exposing token text", async () => {
  const { api, values } = fixture({ [indexKey]: "[\"bad.id\"]" });
  await assert.rejects(api.loadConnectionProfiles(), /账号列表读取失败/);
  assert.equal(values.get(indexKey), '["bad.id"]');
  const broken = fixture({ [indexKey]: '["a"]', [prefix + "a"]: '{"token":"private-secret"' });
  await assert.rejects(broken.api.loadConnectionProfiles(), (error) => !error.message.includes("private-secret") && error.message.includes("账号记录读取失败"));
});

test("unavailable storage reports inability to save and does not write credentials", async () => {
  const { api, values } = fixture({}, false);
  assert.equal(await api.loadConnectionProfiles(), null);
  assert.equal(await api.saveConnectionProfile({ name: "A", url: "wss://a.example.com", token: "a-token" }), null);
  assert.equal(await api.deleteConnectionProfile("a"), false);
  assert.equal(values.size, 0);
});

test("invalid names, addresses and deleted records cannot overwrite existing accounts", async () => {
  const { api } = fixture();
  await assert.rejects(api.saveConnectionProfile({ name: " ", url: "wss://a.example.com", token: "" }), /账号名称/);
  for (const url of ["https://example.com", "invalid", "wss://user:password@example.com"]) {
    await assert.rejects(api.saveConnectionProfile({ name: "A", url, token: "" }));
  }
  await assert.rejects(api.saveConnectionProfile({ id: "missing", name: "A", url: "wss://a.example.com", token: "" }), /账号已删除/);
  assert.equal((await api.loadConnectionProfiles()).length, 0);
});
