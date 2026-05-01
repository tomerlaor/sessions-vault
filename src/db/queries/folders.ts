import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../client";
import { watchedFolders } from "../schema";
import type { WatchedFolder } from "../../types";

export async function getWatchedFolders(): Promise<WatchedFolder[]> {
  const db = await getDb();
  return db.select().from(watchedFolders);
}

export async function addFolder(path: string): Promise<WatchedFolder> {
  const db = await getDb();
  const folder: WatchedFolder = {
    id: nanoid(),
    path,
    addedAt: Math.floor(Date.now() / 1000),
  };
  await db.insert(watchedFolders).values(folder).onConflictDoNothing();
  return folder;
}

export async function removeFolder(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(watchedFolders).where(eq(watchedFolders.id, id));
}
