import { invoke } from "@tauri-apps/api/core";
import { setGDriveConfig } from "../db/queries/backups";
import type { GDriveConfig } from "../types";

interface GDriveTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Returns a usable access token, refreshing it first if it's expired or
 * about to expire. Persists a refreshed token back to config/keychain. */
export async function ensureFreshGDriveToken(
  cfg: GDriveConfig,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cfg.accessToken && cfg.tokenExpiry && cfg.tokenExpiry - now > 60) {
    return cfg.accessToken;
  }
  if (!cfg.refreshToken) throw new Error("Not connected to Google Drive");
  const tokens = await invoke<GDriveTokens>("gdrive_refresh", {
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    refreshToken: cfg.refreshToken,
  });
  const updated: GDriveConfig = {
    ...cfg,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenExpiry: Math.floor(Date.now() / 1000) + tokens.expiresIn,
  };
  await setGDriveConfig(updated);
  return tokens.accessToken;
}
