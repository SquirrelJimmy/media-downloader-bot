# Database Guidelines

## Scope

This directory owns SQLite/libsql setup, schema definitions, migrations, and shared queries. The app uses SQLite as the single-container persistence layer.

## Migration Rules

- Keep migrations idempotent. Prefer `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and guarded `ALTER TABLE` helpers.
- Use `retrySqliteBusy()` for startup migrations and hot paths that may hit Docker or concurrent runtime locks.
- Do not introduce a second database connection strategy without checking worker, API, and bootstrap behavior.
- Preserve existing tables unless a migration and compatibility path are explicit.

## Data Safety

Never commit real `.db`, `.sqlite`, WAL/SHM files, downloads, sessions, or local config. Tests should use temporary database paths and clean up after themselves.

## Tests

Add query and migration tests for schema changes, conflict behavior, and SQLite busy handling.
