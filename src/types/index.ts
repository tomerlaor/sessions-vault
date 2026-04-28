export interface ProjectMetadata {
  filePath: string
  fileHash: string
  daw: string
  dawVersion: string | null
  bpm: number | null
  key: string | null
  timeSignature: string | null
  trackCount: number | null
  durationSecs: number | null
  sizeBytes: number
  createdAt: number
  modifiedAt: number
}

export type Instrument = 'guitar' | 'bass' | 'drums'

export type AIProvider = 'openai' | 'anthropic' | 'ollama' | 'lmstudio'

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  baseUrl: string
  model: string
}

export interface TabPart {
  id: string
  name: string
  instrument: Instrument
  content: string
}

export interface Project {
  id: string
  filePath: string
  fileHash: string | null
  title: string
  daw: string
  dawVersion: string | null
  bpm: number | null
  key: string | null
  timeSignature: string | null
  trackCount: number | null
  sizeBytes: number
  status: 'draft' | 'mixed' | 'released' | 'archived'
  rating: number | null
  notes: string | null
  lyrics: string | null
  todos: string | null
  tabs: string | null
  durationSecs: number | null
  createdAt: number
  modifiedAt: number
  lastScannedAt: number
  tags?: string[]
}

export interface BackupRecord {
  id: string
  projectId: string
  provider: 'local' | 'gdrive'
  destination: string
  snapshotAt: number
  status: 'ok' | 'failed'
  sizeBytes: number | null
  checksum: string | null
  errorMsg: string | null
}

export interface LocalConfig {
  destination: string
}

export interface GDriveConfig {
  clientId: string
  clientSecret: string
  refreshToken: string | null
  accessToken: string | null
  tokenExpiry: number | null  // unix timestamp
}

export interface Tag {
  id: string
  name: string
  color: string
}

export interface WatchedFolder {
  id: string
  path: string
  addedAt: number
}

export type LyricSuggestionMode = 'completion' | 'alternative' | 'next_line'
export type LyricFeedbackMode = 'minimal' | 'tagged'
export type LyricDisplayMode = 'inline' | 'popup'
export type LyricRejectionTag = 'too_cheesy' | 'good_rhyme' | 'wrong_vibe' | 'other'

export interface LyricsAIConfig {
  enabled: boolean
  mode: LyricDisplayMode
  enabledModes: LyricSuggestionMode[]
  feedbackMode: LyricFeedbackMode
}
