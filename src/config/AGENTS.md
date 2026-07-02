# Configuration Guidelines

## Scope

This directory owns YAML loading, saving, defaults, compatibility mapping, and schema normalization.

## Rules

- `parseAppConfig()` must accept missing config and return safe defaults so Docker can start before Telegram is configured.
- Preserve legacy field compatibility unless intentionally removed with migration notes.
- Keep secret values as plain config values only where required; do not log or expose them through UI/API responses unnecessarily.
- Save normalized config through `saveAppConfig()` so UI changes round-trip to `APP_CONFIG_PATH`.
- Docker defaults must use container paths such as `/app/downloads`, `/app/storage/tmp`, and `/app/storage/sessions`.

## Tests

Update config tests when adding fields, defaults, or compatibility aliases. Include both empty-config and legacy-config cases.
