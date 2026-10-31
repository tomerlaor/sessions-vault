import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../client";
import { backups, backupConfigs } from "../schema";
import { invoke } from "@tauri-apps/api/core";
import type { BackupRecord, LocalConfig, GDriveConfig } from "../../types";

export async function getBackups(projectId: string): Promise<BackupRecord[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(backups)
    .where(eq(backups.projectId, projectId))
    .orderBy(desc(backups.snapshotAt));
  return rows.map((r) => ({
    ...r,
    provider: r.provider as BackupRecord["provider"],
    status: r.status as BackupRecord["status"],
  }));
}

export async function insertBackup(
  record: Omit<BackupRecord, "id">,
): Promise<void> {
  const db = await getDb();
  await db.insert(backups).values({ ...record, id: nanoid() });
}

export async function getLocalConfig(): Promise<LocalConfig | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(backupConfigs)
    .where(eq(backupConfigs.id, "local"));
  if (!rows[0]) return null;
  return JSON.parse(rows[0].configJson) as LocalConfig;
}

export async function setLocalConfig(config: LocalConfig): Promise<void> {
  const db = await getDb();
  await db
    .insert(backupConfigs)
    .values({ id: "local", configJson: JSON.stringify(config) })
    .onConflictDoUpdate({
      target: backupConfigs.id,
      set: { configJson: JSON.stringify(config) },
    });
}

async function readGDriveRow(): Promise<{
  clientId?: string;
  connected?: boolean;
} | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(backupConfigs)
    .where(eq(backupConfigs.id, "gdrive"));
  if (!rows[0]) return null;
  return JSON.parse(rows[0].configJson);
}

// Drive settings without any credentials: those stay in the Rust backend.
// Configs saved before the `connected` flag existed ask the backend, which
// checks for a stored refresh token without reading it (no keychain prompt).
export async function getGDriveConfig(): Promise<GDriveConfig | null> {
  const row = await readGDriveRow();
  if (!row) return null;
  const connected =
    typeof row.connected === "boolean"
      ? row.connected
      : await invoke<boolean>("gdrive_connected");
  return { clientId: row.clientId ?? "", connected };
}

export async function isGDriveConnected(): Promise<boolean> {
  return (await getGDriveConfig())?.connected ?? false;
}

export async function setGDriveConfig(config: GDriveConfig): Promise<void> {
  const db = await getDb();
  const json = JSON.stringify(config);
  await db
    .insert(backupConfigs)
    .values({ id: "gdrive", configJson: json })
    .onConflictDoUpdate({
      target: backupConfigs.id,
      set: { configJson: json },
    });
}

// Runs the OAuth flow in the backend, which keeps the client secret and
// tokens; only the client ID and a connected flag are saved here.
export async function connectGDrive(
  clientId: string,
  clientSecret: string,
): Promise<void> {
  await invoke("gdrive_connect", { clientId, clientSecret });
  await setGDriveConfig({ clientId, connected: true });
}

export async function disconnectGDrive(): Promise<void> {
  await invoke("gdrive_disconnect");
  await setGDriveConfig({ clientId: "", connected: false });
}

export async function getGDriveFolderConfig(): Promise<LocalConfig | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(backupConfigs)
    .where(eq(backupConfigs.id, "gdrive-folder"));
  if (!rows[0]) return null;
  return JSON.parse(rows[0].configJson) as LocalConfig;
}

export async function setGDriveFolderConfig(
  config: LocalConfig,
): Promise<void> {
  const db = await getDb();
  await db
    .insert(backupConfigs)
    .values({ id: "gdrive-folder", configJson: JSON.stringify(config) })
    .onConflictDoUpdate({
      target: backupConfigs.id,
      set: { configJson: JSON.stringify(config) },
    });
}
