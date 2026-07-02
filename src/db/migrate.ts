import { configureDatabaseRuntime, libsqlClient, retrySqliteBusy } from "@/db/client";

const tableStatements = [
  `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    chat_id TEXT NOT NULL,
    chat_title TEXT,
    task_type TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    start_time TEXT DEFAULT (datetime('now')),
    end_time TEXT,
    total_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    skip_count INTEGER NOT NULL DEFAULT 0,
    stopped_count INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued',
    filter TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    chat_id TEXT NOT NULL,
    chat_title TEXT,
    sender_id TEXT,
    sender_name TEXT,
    forward_sender_id TEXT,
    forward_sender_name TEXT,
    forward_chat_id TEXT,
    forward_chat_title TEXT,
    forward_message_id INTEGER,
    forward_date TEXT,
    message_date TEXT,
    download_date TEXT DEFAULT (datetime('now')),
    file_name TEXT NOT NULL,
    file_size INTEGER,
    file_sha256 TEXT,
    media_type TEXT,
    media_group_id TEXT,
    file_format TEXT,
    caption TEXT,
    save_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    source TEXT NOT NULL DEFAULT 'auto',
    error_msg TEXT,
    download_speed REAL,
    task_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS file_index (
    sha256 TEXT PRIMARY KEY,
    first_seen TEXT DEFAULT (datetime('now')),
    file_size INTEGER,
    ref_count INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS task_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL UNIQUE,
    task_external_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    payload TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    locked_by TEXT,
    locked_until TEXT,
    available_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_error TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS chat_progress (
    chat_id TEXT PRIMARY KEY,
    chat_title TEXT,
    configured_last_read_message_id INTEGER NOT NULL DEFAULT 0,
    last_read_message_id INTEGER NOT NULL DEFAULT 0,
    last_queued_message_id INTEGER,
    last_task_external_id TEXT,
    last_scan_started_at TEXT,
    last_scan_finished_at TEXT,
    last_error TEXT,
    total_scanned INTEGER NOT NULL DEFAULT 0,
    total_queued INTEGER NOT NULL DEFAULT 0,
    total_skipped INTEGER NOT NULL DEFAULT 0,
    total_failed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE TABLE IF NOT EXISTS listen_forward_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_chat_id TEXT NOT NULL,
    target_chat_id TEXT NOT NULL,
    filter TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_read_message_id INTEGER NOT NULL DEFAULT 0,
    poll_interval_seconds INTEGER NOT NULL DEFAULT 10,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
];

const postColumnStatements = [
  `CREATE INDEX IF NOT EXISTS idx_downloads_chat ON downloads(chat_id, download_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status, download_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_downloads_sha256 ON downloads(file_sha256)`,
  `CREATE INDEX IF NOT EXISTS idx_downloads_task ON downloads(task_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, start_time DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_chat ON tasks(chat_id, start_time DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_task_queue_status_available ON task_queue(status, available_at)`,
  `CREATE INDEX IF NOT EXISTS idx_task_queue_lock ON task_queue(locked_until)`,
  `CREATE INDEX IF NOT EXISTS idx_task_queue_task ON task_queue(task_external_id)`,
  `CREATE INDEX IF NOT EXISTS idx_task_queue_chat ON task_queue(chat_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_progress_updated ON chat_progress(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_listen_forward_enabled ON listen_forward_rules(enabled, updated_at)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS downloads_fts USING fts5(
    file_name,
    caption,
    chat_title,
    content='downloads',
    content_rowid='id'
  )`,
];

const downloadColumns = [
  { name: "chat_title", type: "TEXT" },
  { name: "sender_id", type: "TEXT" },
  { name: "sender_name", type: "TEXT" },
  { name: "forward_sender_id", type: "TEXT" },
  { name: "forward_sender_name", type: "TEXT" },
  { name: "forward_chat_id", type: "TEXT" },
  { name: "forward_chat_title", type: "TEXT" },
  { name: "forward_message_id", type: "INTEGER" },
  { name: "forward_date", type: "TEXT" },
  { name: "message_date", type: "TEXT" },
  { name: "download_date", type: "TEXT" },
  { name: "file_size", type: "INTEGER" },
  { name: "file_sha256", type: "TEXT" },
  { name: "media_type", type: "TEXT" },
  { name: "media_group_id", type: "TEXT" },
  { name: "file_format", type: "TEXT" },
  { name: "caption", type: "TEXT" },
  { name: "error_msg", type: "TEXT" },
  { name: "download_speed", type: "REAL" },
  { name: "task_id", type: "INTEGER" },
];

const taskColumns = [
  { name: "chat_title", type: "TEXT" },
  { name: "source", type: "TEXT NOT NULL DEFAULT 'manual'" },
  { name: "start_time", type: "TEXT" },
  { name: "end_time", type: "TEXT" },
  { name: "stopped_count", type: "INTEGER NOT NULL DEFAULT 0" },
  { name: "total_bytes", type: "INTEGER NOT NULL DEFAULT 0" },
  { name: "filter", type: "TEXT" },
];

const taskQueueColumns = [
  { name: "priority", type: "INTEGER NOT NULL DEFAULT 0" },
  { name: "attempts", type: "INTEGER NOT NULL DEFAULT 0" },
  { name: "max_attempts", type: "INTEGER NOT NULL DEFAULT 3" },
  { name: "locked_by", type: "TEXT" },
  { name: "locked_until", type: "TEXT" },
  { name: "available_at", type: "TEXT" },
  { name: "last_error", type: "TEXT" },
  { name: "created_at", type: "TEXT" },
  { name: "updated_at", type: "TEXT" },
  { name: "completed_at", type: "TEXT" },
];

const chatProgressColumns = [
  { name: "configured_last_read_message_id", type: "INTEGER NOT NULL DEFAULT 0" },
  { name: "last_read_message_id", type: "INTEGER NOT NULL DEFAULT 0" },
  { name: "last_queued_message_id", type: "INTEGER" },
  { name: "last_task_external_id", type: "TEXT" },
  { name: "last_scan_started_at", type: "TEXT" },
  { name: "last_scan_finished_at", type: "TEXT" },
  { name: "last_error", type: "TEXT" },
  { name: "total_scanned", type: "INTEGER NOT NULL DEFAULT 0" },
  { name: "total_queued", type: "INTEGER NOT NULL DEFAULT 0" },
  { name: "total_skipped", type: "INTEGER NOT NULL DEFAULT 0" },
  { name: "total_failed", type: "INTEGER NOT NULL DEFAULT 0" },
  { name: "updated_at", type: "TEXT" },
];

const listenForwardColumns = [
  { name: "filter", type: "TEXT" },
  { name: "enabled", type: "INTEGER NOT NULL DEFAULT 1" },
  { name: "last_read_message_id", type: "INTEGER NOT NULL DEFAULT 0" },
  { name: "poll_interval_seconds", type: "INTEGER NOT NULL DEFAULT 10" },
  { name: "created_at", type: "TEXT" },
  { name: "updated_at", type: "TEXT" },
];

async function ensureColumns(tableName: string, columns: Array<{ name: string; type: string }>) {
  const info = await retrySqliteBusy(() => libsqlClient.execute(`PRAGMA table_info(${tableName})`));
  const existing = new Set(info.rows.map((row) => String(row.name)));

  for (const column of columns) {
    if (!existing.has(column.name)) {
      await retrySqliteBusy(() =>
        libsqlClient.execute(`ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.type}`),
      );
    }
  }
}

async function backfillMigratedTimestamps() {
  await retrySqliteBusy(() =>
    libsqlClient.execute("UPDATE downloads SET download_date = datetime('now') WHERE download_date IS NULL"),
  );
  await retrySqliteBusy(() =>
    libsqlClient.execute("UPDATE tasks SET start_time = datetime('now') WHERE start_time IS NULL"),
  );
  await retrySqliteBusy(() =>
    libsqlClient.execute("UPDATE task_queue SET available_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE available_at IS NULL"),
  );
  await retrySqliteBusy(() =>
    libsqlClient.execute("UPDATE task_queue SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_at IS NULL"),
  );
  await retrySqliteBusy(() =>
    libsqlClient.execute("UPDATE task_queue SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE updated_at IS NULL"),
  );
  await retrySqliteBusy(() =>
    libsqlClient.execute("UPDATE chat_progress SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE updated_at IS NULL"),
  );
  await retrySqliteBusy(() =>
    libsqlClient.execute("UPDATE listen_forward_rules SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_at IS NULL"),
  );
  await retrySqliteBusy(() =>
    libsqlClient.execute("UPDATE listen_forward_rules SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE updated_at IS NULL"),
  );
}

export async function migrate() {
  await configureDatabaseRuntime();
  for (const statement of tableStatements) {
    await retrySqliteBusy(() => libsqlClient.execute(statement));
  }
  await ensureColumns("downloads", downloadColumns);
  await ensureColumns("tasks", taskColumns);
  await ensureColumns("task_queue", taskQueueColumns);
  await ensureColumns("chat_progress", chatProgressColumns);
  await ensureColumns("listen_forward_rules", listenForwardColumns);
  await backfillMigratedTimestamps();
  for (const statement of postColumnStatements) {
    await retrySqliteBusy(() => libsqlClient.execute(statement));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => {
      console.log("Database migration completed");
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
