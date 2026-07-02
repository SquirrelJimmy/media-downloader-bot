# Utility Guidelines

## Scope

Utilities here should be small, deterministic helpers for formatting, URL parsing, Telegram storage paths, file moves, logging, links, and binary management.

## Rules

- Prefer reusable helpers over ad hoc parsing in feature code.
- Keep path helpers Docker-safe and relative-path aware.
- Use `moveFileAcrossDevices()` for final file moves that may cross bind mounts.
- Do not add network side effects to generic utilities unless the helper is explicitly for downloading or probing an external binary.
- Keep filename/path sanitization conservative; user-supplied Telegram captions and URLs can contain unsafe characters.

## Tests

Add focused tests for edge cases: malformed URLs, cross-device file moves, platform-specific binary names, path normalization, and unsafe filenames.
