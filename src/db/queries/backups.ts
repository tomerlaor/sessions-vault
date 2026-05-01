import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../client";
import { backups, backupConfigs } from "../schema";
import { storeSecret, getSecret, deleteSecret } from "../../lib/keychain";
import type { BackupRecord, LocalConfig, GDriveConfig } from "../../types";

const K_GDRIVE_CLIENT_SECRET = "gdrive.client_secret";
const K_GDRIVE_ACCESS_TOKEN = "gdrive.access_token";
const K_GDRIVE_REFRESH_TOKEN = "gdrive.refresh_token";

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

export async function getGDriveConfig(): Promise<GDriveConfig | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(backupConfigs)
    .where(eq(backupConfigs.id, "gdrive"));
  if (!rows[0]) return null;
  const safe = JSON.parse(rows[0].configJson) as Pick<
    GDriveConfig,
    "clientId" | "tokenExpiry"
  >;
  const [clientSecret, accessToken, refreshToken] = await Promise.all([
    getSecret(K_GDRIVE_CLIENT_SECRET),
    getSecret(K_GDRIVE_ACCESS_TOKEN),
    getSecret(K_GDRIVE_REFRESH_TOKEN),
  ]);
  return {
    ...safe,
    clientSecret: clientSecret ?? "",
    accessToken: accessToken ?? "",
    refreshToken: refreshToken ?? "",
  };
}

export async function setGDriveConfig(config: GDriveConfig): Promise<void> {
  const db = await getDb();
  // Secrets go to the OS keychain; null means disconnecting — delete stored entries
  if (config.clientSecret)
    await storeSecret(K_GDRIVE_CLIENT_SECRET, config.clientSecret);
  else await deleteSecret(K_GDRIVE_CLIENT_SECRET);
  if (config.accessToken)
    await storeSecret(K_GDRIVE_ACCESS_TOKEN, config.accessToken);
  else await deleteSecret(K_GDRIVE_ACCESS_TOKEN);
  if (config.refreshToken)
    await storeSecret(K_GDRIVE_REFRESH_TOKEN, config.refreshToken);
  else await deleteSecret(K_GDRIVE_REFRESH_TOKEN);
  // Only non-sensitive config lives in SQLite
  const safe = { clientId: config.clientId, tokenExpiry: config.tokenExpiry };
  await db
    .insert(backupConfigs)
    .values({ id: "gdrive", configJson: JSON.stringify(safe) })
    .onConflictDoUpdate({
      target: backupConfigs.id,
      set: { configJson: JSON.stringify(safe) },
    });
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
