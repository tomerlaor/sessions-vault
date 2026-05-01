import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ProjectMetadata } from "../types";
import { buildUpsertRow } from "./metadata";
import {
  upsertProject,
  getProjectByPath,
  getProjectByHash,
  updateProjectFilePath,
  deleteProjectByPath,
} from "../db/queries/projects";

export async function startWatcher(
  paths: string[],
  onUpdate: () => void,
): Promise<UnlistenFn> {
  await invoke("start_watcher", { paths });

  const unlistenUpdated = await listen<ProjectMetadata>(
    "project:updated",
    async (e) => {
      const meta = e.payload;
      let existing = await getProjectByPath(meta.filePath);

      if (!existing && meta.fileHash) {
        // File may have been renamed (e.g. case change on macOS): same hash, different path
        const byHash = await getProjectByHash(meta.fileHash);
        if (byHash) {
          await updateProjectFilePath(byHash.id, meta.filePath);
          onUpdate();
          return;
        }
      }

      const row = buildUpsertRow(meta, existing?.title ?? null);
      await upsertProject(row);
      onUpdate();
    },
  );

  const unlistenDeleted = await listen<string>("project:deleted", async (e) => {
    await deleteProjectByPath(e.payload);
    onUpdate();
  });

  return () => {
    unlistenUpdated();
    unlistenDeleted();
  };
}
