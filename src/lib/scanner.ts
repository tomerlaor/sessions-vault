import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ProjectMetadata } from '../types'
import { buildUpsertRow } from './metadata'
import { upsertProject, getProjectByPath } from '../db/queries/projects'
import { addFolder } from '../db/queries/folders'

export interface ScanProgress {
  scanned: number
  total: number
  folder: string
}

export async function scanFolder(
  path: string,
  onProgress?: (p: ScanProgress) => void
): Promise<number> {
  const unlistenProgress = await listen<ScanProgress>('scan:progress', e => {
    onProgress?.(e.payload)
  })

  const metadataList = await invoke<ProjectMetadata[]>('scan_folder', { path })

  for (const meta of metadataList) {
    const existing = await getProjectByPath(meta.filePath)
    const row = buildUpsertRow(meta, existing?.title ?? null)
    await upsertProject(row)
  }

  await addFolder(path)
  unlistenProgress()
  return metadataList.length
}
