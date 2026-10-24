import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { backupConfigs } from "../schema";
import { storeSecret, getSecret, secretExists } from "../../lib/keychain";
import type { AIConfig, AIFeature, AIProvider } from "../../types";
import { resolveFeatureConfig } from "../../lib/ai";

const AI_CONFIG_ID = "ai";

function aiKeyName(provider: string) {
  return `ai.apikey.${provider}`;
}

// Settings view: never touches the keychain, so opening Settings can't prompt.
export async function getAIConfigWithoutKey(): Promise<AIConfig | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(backupConfigs)
    .where(eq(backupConfigs.id, AI_CONFIG_ID));
  if (!rows[0]) return null;
  try {
    const safe = JSON.parse(rows[0].configJson) as Omit<AIConfig, "apiKey">;
    return { ...safe, apiKey: "" };
  } catch {
    return null;
  }
}

export async function getAIConfig(): Promise<AIConfig | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(backupConfigs)
    .where(eq(backupConfigs.id, AI_CONFIG_ID));
  if (!rows[0]) return null;
  try {
    const safe = JSON.parse(rows[0].configJson) as Omit<AIConfig, "apiKey">;
    const apiKey = (await getSecret(aiKeyName(safe.provider))) ?? "";
    return { ...safe, apiKey };
  } catch {
    return null;
  }
}

export async function getAIKey(provider: AIProvider): Promise<string> {
  return (await getSecret(aiKeyName(provider))) ?? "";
}

export function hasAIKey(provider: AIProvider): Promise<boolean> {
  return secretExists(aiKeyName(provider));
}

export async function getAIConfigFor(
  feature: AIFeature,
): Promise<AIConfig | null> {
  const cfg = await getAIConfig();
  return cfg ? resolveFeatureConfig(cfg, feature) : null;
}

export async function setAIConfig(cfg: AIConfig): Promise<void> {
  const db = await getDb();
  if (cfg.apiKey) await storeSecret(aiKeyName(cfg.provider), cfg.apiKey);
  const { apiKey: _, ...safe } = cfg;
  await db
    .insert(backupConfigs)
    .values({ id: AI_CONFIG_ID, configJson: JSON.stringify(safe) })
    .onConflictDoUpdate({
      target: backupConfigs.id,
      set: { configJson: JSON.stringify(safe) },
    });
}
