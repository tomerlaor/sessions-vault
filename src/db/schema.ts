import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
} from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  filePath: text("file_path").notNull().unique(),
  fileHash: text("file_hash"),
  title: text("title").notNull(),
  daw: text("daw").notNull(),
  dawVersion: text("daw_version"),
  bpm: real("bpm"),
  key: text("key"),
  timeSignature: text("time_signature"),
  trackCount: integer("track_count"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  status: text("status").notNull().default("draft"),
  rating: integer("rating"),
  notes: text("notes"),
  lyrics: text("lyrics"),
  todos: text("todos"),
  tabs: text("tabs"),
  lyricsContext: text("lyrics_context"),
  aiOptOut: integer("ai_opt_out", { mode: "boolean" }).notNull().default(false),
  durationSecs: real("duration_secs"),
  createdAt: integer("created_at").notNull(),
  modifiedAt: integer("modified_at").notNull(),
  lastScannedAt: integer("last_scanned_at").notNull(),
});

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull(),
});

export const projectTags = sqliteTable(
  "project_tags",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.projectId, t.tagId] }) }),
);

export const watchedFolders = sqliteTable("watched_folders", {
  id: text("id").primaryKey(),
  path: text("path").notNull().unique(),
  addedAt: integer("added_at").notNull(),
});

export const backups = sqliteTable("backups", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // 'local' | 'gdrive'
  destination: text("destination").notNull(), // local path or GDrive file ID
  snapshotAt: integer("snapshot_at").notNull(), // unix timestamp
  status: text("status").notNull(), // 'ok' | 'partial' | 'failed'
  sizeBytes: integer("size_bytes"),
  checksum: text("checksum"),
  errorMsg: text("error_msg"),
  manifestJson: text("manifest_json"), // full manifest.json contents
  stages: text("stages"), // JSON array of included stage keys
  missingCount: integer("missing_count").default(0),
});

export const backupConfigs = sqliteTable("backup_configs", {
  id: text("id").primaryKey(), // 'local' | 'gdrive' | 'stage-selection'
  configJson: text("config_json").notNull(),
});

// Unused until PR2 (restore/verify).
export const backupFiles = sqliteTable("backup_files", {
  id: text("id").primaryKey(),
  backupId: text("backup_id")
    .notNull()
    .references(() => backups.id, { onDelete: "cascade" }),
  projectFileId: text("project_file_id"),
  archivePath: text("archive_path").notNull(),
  originalPath: text("original_path").notNull(),
  stage: text("stage"),
  versionLabel: text("version_label"),
  isFinal: integer("is_final", { mode: "boolean" }).notNull().default(false),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  status: text("status").notNull(), // 'ok' | 'missing' | 'unreadable'
});

// Unused until PR2 (restore/verify).
export const backupRestores = sqliteTable("backup_restores", {
  id: text("id").primaryKey(),
  backupId: text("backup_id")
    .notNull()
    .references(() => backups.id, { onDelete: "cascade" }),
  restoredTo: text("restored_to").notNull(),
  restoredAt: integer("restored_at").notNull(),
  okCount: integer("ok_count").notNull(),
  mismatchCount: integer("mismatch_count").notNull(),
  errorMsg: text("error_msg"),
});

export const lyricStyleEvents = sqliteTable("lyric_style_events", {
  id: text("id").primaryKey(),
  projectId: text("project_id"),
  suggestionText: text("suggestion_text").notNull(),
  mode: text("mode").notNull(),
  accepted: integer("accepted").notNull(),
  tag: text("tag"),
  createdAt: integer("created_at").notNull(),
});

export const lyricStyleProfile = sqliteTable("lyric_style_profile", {
  id: text("id").primaryKey(),
  summaryText: text("summary_text").notNull(),
  lastUpdatedAt: integer("last_updated_at").notNull(),
});

export const projectFiles = sqliteTable("project_files", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'mix_project' | 'master_project' | 'export'
  exportType: text("export_type"),
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  versionLabel: text("version_label").notNull(),
  fileDate: integer("file_date").notNull(),
  isFinal: integer("is_final", { mode: "boolean" }).notNull().default(false),
  linkedProjectId: text("linked_project_id"),
  sampleRate: integer("sample_rate"),
  bitDepth: integer("bit_depth"),
  channels: integer("channels"),
  durationSecs: real("duration_secs"),
  peakDb: real("peak_db"),
  clipped: integer("clipped", { mode: "boolean" }).notNull().default(false),
  lossy: integer("lossy", { mode: "boolean" }).notNull().default(false),
  mediaMissingCount: integer("media_missing_count"),
  mediaExternalCount: integer("media_external_count"),
  note: text("note"),
  createdAt: integer("created_at").notNull(),
});
