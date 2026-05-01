import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../client";
import { tags, projectTags } from "../schema";
import type { Tag } from "../../types";

export const TAG_COLORS = [
  "#ff7a45",
  "#ffcc66",
  "#5cd18b",
  "#0ea5e9",
  "#a98bff",
  "#ff5a5a",
  "#34d399",
  "#f472b6",
  "#fb923c",
  "#818cf8",
];

export function nextColor(existingCount: number): string {
  return TAG_COLORS[existingCount % TAG_COLORS.length];
}

export async function getTags(): Promise<Tag[]> {
  const db = await getDb();
  return db.select().from(tags);
}

export async function createTag(name: string, color: string): Promise<Tag> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Tag name cannot be empty");
  const db = await getDb();
  await db
    .insert(tags)
    .values({ id: nanoid(), name: trimmed, color })
    .onConflictDoNothing();
  const rows = await db.select().from(tags).where(eq(tags.name, trimmed));
  return rows[0];
}

export async function assignTag(
  projectId: string,
  tagId: string,
): Promise<void> {
  const db = await getDb();
  await db
    .insert(projectTags)
    .values({ projectId, tagId })
    .onConflictDoNothing();
}

export async function removeTag(
  projectId: string,
  tagId: string,
): Promise<void> {
  const db = await getDb();
  await db
    .delete(projectTags)
    .where(
      and(eq(projectTags.projectId, projectId), eq(projectTags.tagId, tagId)),
    );
}
