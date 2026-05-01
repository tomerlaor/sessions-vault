import { nanoid } from 'nanoid'
import type { ProjectMetadata } from '../types'

export interface UpsertRow {
  id: string
  filePath: string
  fileHash: string
  title: string
  daw: string
  dawVersion: string | null
  bpm: number | null
  key: string | null
  timeSignature: string | null
  trackCount: number | null
  durationSecs: number | null
  sizeBytes: number
  status: 'draft' | 'mixed' | 'released' | 'archived'
  rating: number | null
  notes: string | null
  createdAt: number
  modifiedAt: number
  lastScannedAt: number
}

export function buildUpsertRow(meta: ProjectMetadata, existingTitle: string | null): UpsertRow {
  const derivedTitle = meta.filePath
    .split('/')
    .pop()
    ?.replace(/\.[^.]+$/, '')
    ?.replace(/[-_]/g, ' ') ?? 'Untitled'

  return {
    id: nanoid(),
    filePath: meta.filePath,
    fileHash: meta.fileHash,
    title: existingTitle ?? derivedTitle,
    daw: meta.daw,
    dawVersion: meta.dawVersion,
    bpm: meta.bpm,
    key: meta.key,
    timeSignature: meta.timeSignature,
    trackCount: meta.trackCount,
    durationSecs: meta.durationSecs,
    sizeBytes: meta.sizeBytes,
    status: 'draft',
    rating: null,
    notes: null,
    createdAt: meta.createdAt,
    modifiedAt: meta.modifiedAt,
    lastScannedAt: Math.floor(Date.now() / 1000),
  }
}
