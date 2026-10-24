import { eq, and, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../client";
import { projectFiles } from "../schema";
import type { ProjectFile } from "../../types";

export type NewProjectFile = Omit<ProjectFile, "id" | "createdAt">;

export async function listFiles(projectId: string): Promise<ProjectFile[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(projectFiles)
    .where(eq(projectFiles.projectId, projectId));
  return rows as ProjectFile[];
}

export async function addFile(file: NewProjectFile): Promise<ProjectFile> {
  const db = await getDb();
  const row = { ...file, id: nanoid(), createdAt: Date.now() };
  await db.insert(projectFiles).values(row);
  if (row.isFinal) await setFinal(row.projectId, row.id);
  return row as ProjectFile;
}

export async function updateFile(
  id: string,
  patch: Partial<Omit<ProjectFile, "id" | "projectId" | "createdAt">>,
): Promise<void> {
  const db = await getDb();
  await db.update(projectFiles).set(patch).where(eq(projectFiles.id, id));
}

export async function removeFile(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(projectFiles).where(eq(projectFiles.id, id));
}

export async function setFinal(
  projectId: string,
  fileId: string,
): Promise<void> {
  const db = await getDb();
  await db
    .update(projectFiles)
    .set({ isFinal: true })
    .where(eq(projectFiles.id, fileId));
  await db
    .update(projectFiles)
    .set({ isFinal: false })
    .where(
      and(eq(projectFiles.projectId, projectId), ne(projectFiles.id, fileId)),
    );
}
