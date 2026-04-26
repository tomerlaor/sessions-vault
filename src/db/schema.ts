import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable('projects', {
  id:            text('id').primaryKey(),
  filePath:      text('file_path').notNull().unique(),
  fileHash:      text('file_hash'),
  title:         text('title').notNull(),
  daw:           text('daw').notNull(),
  dawVersion:    text('daw_version'),
  bpm:           real('bpm'),
  key:           text('key'),
  timeSignature: text('time_signature'),
  trackCount:    integer('track_count'),
  sizeBytes:     integer('size_bytes').notNull().default(0),
  status:        text('status').notNull().default('draft'),
  rating:        integer('rating'),
  notes:         text('notes'),
  lyrics:        text('lyrics'),
  todos:         text('todos'),
  tabs:          text('tabs'),
  durationSecs:  real('duration_secs'),
  createdAt:     integer('created_at').notNull(),
  modifiedAt:    integer('modified_at').notNull(),
  lastScannedAt: integer('last_scanned_at').notNull(),
})

export const tags = sqliteTable('tags', {
  id:    text('id').primaryKey(),
  name:  text('name').notNull().unique(),
  color: text('color').notNull(),
})

export const projectTags = sqliteTable('project_tags', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  tagId:     text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, t => ({ pk: primaryKey({ columns: [t.projectId, t.tagId] }) }))

export const watchedFolders = sqliteTable('watched_folders', {
  id:      text('id').primaryKey(),
  path:    text('path').notNull().unique(),
  addedAt: integer('added_at').notNull(),
})

export const backups = sqliteTable('backups', {
  id:          text('id').primaryKey(),
  projectId:   text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  provider:    text('provider').notNull(),        // 'local' | 'gdrive'
  destination: text('destination').notNull(),     // local path or GDrive file ID
  snapshotAt:  integer('snapshot_at').notNull(),  // unix timestamp
  status:      text('status').notNull(),          // 'ok' | 'failed'
  sizeBytes:   integer('size_bytes'),
  checksum:    text('checksum'),
  errorMsg:    text('error_msg'),
})

export const backupConfigs = sqliteTable('backup_configs', {
  id:         text('id').primaryKey(),           // 'local' | 'gdrive'
  configJson: text('config_json').notNull(),
})
