import { describe, it, expect } from 'vitest'
import { buildUpsertRow } from '../src/lib/metadata'
import type { ProjectMetadata } from '../src/types'

const baseMetadata: ProjectMetadata = {
  filePath: '/Music/Projects/test.als',
  fileHash: 'abc123',
  daw: 'ableton',
  dawVersion: '11.3',
  bpm: 128,
  key: 'F Minor',
  timeSignature: '4/4',
  trackCount: 12,
  sizeBytes: 500000,
  createdAt: 1000000,
  modifiedAt: 2000000,
}

describe('buildUpsertRow', () => {
  it('derives title from file path when no existing title', () => {
    const row = buildUpsertRow(baseMetadata, null)
    expect(row.title).toBe('test')
  })

  it('preserves existing title from DB', () => {
    const row = buildUpsertRow(baseMetadata, 'My Custom Title')
    expect(row.title).toBe('My Custom Title')
  })

  it('maps all metadata fields correctly', () => {
    const row = buildUpsertRow(baseMetadata, null)
    expect(row.bpm).toBe(128)
    expect(row.key).toBe('F Minor')
    expect(row.daw).toBe('ableton')
    expect(row.sizeBytes).toBe(500000)
  })
})
