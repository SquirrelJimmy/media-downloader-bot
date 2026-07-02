# Plugin Guidelines

## Scope

Plugins decide whether a normalized message can be downloaded and return a `DownloadResult`. Built-in plugins live in `src/plugins/builtin`, and registration/order lives in `src/plugins/index.ts` and `registry.ts`.

## Implementation Rules

- `canHandle()` must be cheap and side-effect free.
- `download()` may create temp files only under the provided temp directory and must return the final file path, name, size, and status.
- Move files with `moveFileAcrossDevices()` so Docker bind mounts do not fail on `EXDEV`.
- Clean temp directories in `finally` blocks.
- Respect config toggles and user options. Do not hardcode external binary paths or credentials.
- Do not let custom yt-dlp args override project-managed output paths, progress behavior, or execution hooks.

## Tests

Use fake binaries, fake fetch responses, and temp directories. Do not download real network media in unit tests.
