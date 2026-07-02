# Engine Guidelines

## Scope

This directory owns runtime behavior: Telegram clients, Bot commands, workers, queues, task orchestration, pipelines, cancellation, and server bootstrap. Changes here can affect real downloads and long-running Docker deployments.

## Runtime Rules

- Do not start duplicate Bot, worker, or listen-forward loops. Use existing bootstrap state and restart helpers.
- Keep graceful shutdown semantics: restart should stop idle loops and avoid interrupting an active download unless explicitly requested.
- Do not perform real Telegram, yt-dlp, or rclone calls in unit tests. Use fakes, mocks, and temporary directories.
- Treat Telegram `api_hash`, `bot_token`, sessions, phone codes, and 2FA passwords as secrets. Never log them.

## Queue & Task Behavior

- Persist task and queue state before starting work.
- Keep idempotency in mind: Docker restarts and SQLite retries can replay pending work.
- Use existing cancellation, transmission limiting, and media group forwarding helpers rather than adding parallel mechanisms.

## Validation

For changes here, run focused tests plus `npm test` when possible. Add tests for success, failure, skip, stop, retry, and restart behavior when the change touches those paths.
