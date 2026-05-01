import { eq, desc } from "drizzle-orm";
import { getDb } from "../client";
import { projects, projectTags, tags } from "../schema";
import type { UpsertRow } from "../../lib/metadata";
import type { Project } from "../../types";

export async function getProjects(): Promise<Project[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(projects)
    .orderBy(desc(projects.modifiedAt));
  const allTags = await db
    .select({ projectId: projectTags.projectId, name: tags.name })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id));

  return rows.map((row) => ({
    ...row,
    status: row.status as Project["status"],
    tags: allTags.filter((t) => t.projectId === row.id).map((t) => t.name),
  }));
}

export async function upsertProject(row: UpsertRow): Promise<void> {
  const db = await getDb();
  await db
    .insert(projects)
    .values(row)
    .onConflictDoUpdate({
      target: projects.filePath,
      set: {
        fileHash: row.fileHash,
        daw: row.daw,
        dawVersion: row.dawVersion,
        bpm: row.bpm,
        key: row.key,
        timeSignature: row.timeSignature,
        trackCount: row.trackCount,
        durationSecs: row.durationSecs,
        sizeBytes: row.sizeBytes,
        modifiedAt: row.modifiedAt,
        lastScannedAt: row.lastScannedAt,
      },
    });
}

export async function getProjectByPath(
  filePath: string,
): Promise<Project | undefined> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.filePath, filePath));
  return rows[0] as Project | undefined;
}

export async function getProjectByHash(
  fileHash: string,
): Promise<Project | undefined> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.fileHash, fileHash));
  return rows[0] as Project | undefined;
}

export async function updateProjectFilePath(
  id: string,
  newFilePath: string,
): Promise<void> {
  const db = await getDb();
  await db
    .update(projects)
    .set({ filePath: newFilePath })
    .where(eq(projects.id, id));
}

export async function deleteProjectByPath(filePath: string): Promise<void> {
  const db = await getDb();
  await db.delete(projects).where(eq(projects.filePath, filePath));
}

export async function renameProject(
  id: string,
  newTitle: string,
  newFilePath: string,
): Promise<void> {
  const db = await getDb();
  await db
    .update(projects)
    .set({ title: newTitle, filePath: newFilePath })
    .where(eq(projects.id, id));
}

const EDITABLE_FIELDS = new Set([
  "status",
  "notes",
  "key",
  "lyrics",
  "tabs",
  "todos",
  "rating",
]);

export async function updateProjectField(
  id: string,
  field: string,
  value: unknown,
): Promise<void> {
  if (!EDITABLE_FIELDS.has(field))
    throw new Error(`Field not editable: ${field}`);
  const db = await getDb();
  await db
    .update(projects)
    .set({ [field]: value } as any)
    .where(eq(projects.id, id));
}
