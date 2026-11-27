import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { backupConfigs } from "../schema";
import type { AiActivityConfig } from "../../types";

const AI_ACTIVITY_CONFIG_ID = "ai_activity";

// Off by default — opt-in, metadata only. Nothing is written to
// ai-traces.db until the user turns this on in Settings → AI Assistant.
const DEFAULT_AI_ACTIVITY_CONFIG: AiActivityConfig = {
  keepAiActivityLog: false,
};

export async function getAiActivityConfig(): Promise<AiActivityConfig> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(backupConfigs)
    .where(eq(backupConfigs.id, AI_ACTIVITY_CONFIG_ID));
  if (!rows[0]) return DEFAULT_AI_ACTIVITY_CONFIG;
  try {
    return { ...DEFAULT_AI_ACTIVITY_CONFIG, ...JSON.parse(rows[0].configJson) };
  } catch {
    return DEFAULT_AI_ACTIVITY_CONFIG;
  }
}

export const AI_ACTIVITY_CONFIG_CHANGED_EVENT = "ai-activity-config-changed";

export async function setAiActivityConfig(
  cfg: AiActivityConfig,
): Promise<void> {
  const db = await getDb();
  await db
    .insert(backupConfigs)
    .values({ id: AI_ACTIVITY_CONFIG_ID, configJson: JSON.stringify(cfg) })
    .onConflictDoUpdate({
      target: backupConfigs.id,
      set: { configJson: JSON.stringify(cfg) },
    });
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(AI_ACTIVITY_CONFIG_CHANGED_EVENT, { detail: cfg }),
    );
  }
}
