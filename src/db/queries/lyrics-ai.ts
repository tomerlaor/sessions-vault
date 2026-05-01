import { eq, desc, and, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../client";
import { lyricStyleEvents, lyricStyleProfile, backupConfigs } from "../schema";
import type {
  LyricsAIConfig,
  LyricSuggestionMode,
  LyricRejectionTag,
} from "../../types";

const LYRICS_AI_CONFIG_ID = "lyrics_ai";

const DEFAULT_LYRICS_AI_CONFIG: LyricsAIConfig = {
  enabled: false,
  mode: "inline",
  enabledModes: ["completion"],
  feedbackMode: "minimal",
};

export async function getLyricsAIConfig(): Promise<LyricsAIConfig> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(backupConfigs)
    .where(eq(backupConfigs.id, LYRICS_AI_CONFIG_ID));
  if (!rows[0]) return DEFAULT_LYRICS_AI_CONFIG;
  try {
    return { ...DEFAULT_LYRICS_AI_CONFIG, ...JSON.parse(rows[0].configJson) };
  } catch {
    return DEFAULT_LYRICS_AI_CONFIG;
  }
}

export async function setLyricsAIConfig(cfg: LyricsAIConfig): Promise<void> {
  const db = await getDb();
  await db
    .insert(backupConfigs)
    .values({ id: LYRICS_AI_CONFIG_ID, configJson: JSON.stringify(cfg) })
    .onConflictDoUpdate({
      target: backupConfigs.id,
      set: { configJson: JSON.stringify(cfg) },
    });
}

export async function logStyleEvent(event: {
  projectId: string | null;
  suggestionText: string;
  mode: LyricSuggestionMode;
  accepted: boolean;
  tag: LyricRejectionTag | null;
}): Promise<string> {
  const db = await getDb();
  const id = nanoid();
  await db.insert(lyricStyleEvents).values({
    id,
    projectId: event.projectId,
    suggestionText: event.suggestionText,
    mode: event.mode,
    accepted: event.accepted ? 1 : 0,
    tag: event.tag ?? null,
    createdAt: Math.floor(Date.now() / 1000),
  });
  return id;
}

export async function updateEventTag(
  id: string,
  tag: LyricRejectionTag,
): Promise<void> {
  const db = await getDb();
  await db
    .update(lyricStyleEvents)
    .set({ tag })
    .where(eq(lyricStyleEvents.id, id));
}

export async function getRecentAccepted(
  projectId: string | null,
  limit = 20,
): Promise<string[]> {
  const db = await getDb();
  const scopeCondition =
    projectId === null
      ? isNull(lyricStyleEvents.projectId)
      : eq(lyricStyleEvents.projectId, projectId);
  const rows = await db
    .select({ suggestionText: lyricStyleEvents.suggestionText })
    .from(lyricStyleEvents)
    .where(and(scopeCondition, eq(lyricStyleEvents.accepted, 1)))
    .orderBy(desc(lyricStyleEvents.createdAt))
    .limit(limit);
  return rows.map((r) => r.suggestionText);
}

export async function countAcceptedEvents(
  projectId: string | null,
): Promise<number> {
  const db = await getDb();
  const scopeCondition =
    projectId === null
      ? isNull(lyricStyleEvents.projectId)
      : eq(lyricStyleEvents.projectId, projectId);
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(lyricStyleEvents)
    .where(and(scopeCondition, eq(lyricStyleEvents.accepted, 1)));
  return rows[0]?.count ?? 0;
}

export async function getStyleProfile(id: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(lyricStyleProfile)
    .where(eq(lyricStyleProfile.id, id));
  return rows[0]?.summaryText ?? null;
}

export async function upsertStyleProfile(
  id: string,
  summaryText: string,
): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(lyricStyleProfile)
    .values({ id, summaryText, lastUpdatedAt: now })
    .onConflictDoUpdate({
      target: lyricStyleProfile.id,
      set: { summaryText, lastUpdatedAt: now },
    });
}

export async function clearStyleMemory(
  projectId: string | null,
): Promise<void> {
  const db = await getDb();
  const scopeCondition =
    projectId === null
      ? isNull(lyricStyleEvents.projectId)
      : eq(lyricStyleEvents.projectId, projectId);
  await db.delete(lyricStyleEvents).where(scopeCondition);
  const profileId = projectId ?? "global";
  await db.delete(lyricStyleProfile).where(eq(lyricStyleProfile.id, profileId));
}
