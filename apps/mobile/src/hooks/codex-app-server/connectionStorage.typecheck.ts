import {
  clearSavedConnectionConfig,
  DEFAULT_APP_SERVER_URL,
  loadSavedConnectionConfig,
  saveConnectionConfig,
  type SavedConnectionConfig,
} from "./connectionStorage";

const config: SavedConnectionConfig = {
  url: "wss://codex.example.com",
  token: "relay-token",
};

config.url satisfies string;
config.token satisfies string;
DEFAULT_APP_SERVER_URL satisfies string;
loadSavedConnectionConfig satisfies () => Promise<SavedConnectionConfig | null>;
saveConnectionConfig satisfies (config: SavedConnectionConfig) => Promise<"saved" | "unavailable">;
clearSavedConnectionConfig satisfies () => Promise<"cleared" | "unavailable">;
