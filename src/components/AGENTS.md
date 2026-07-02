# Component Guidelines

## Scope

This directory owns React UI, providers, hooks, and page-level console components. Components should consume typed API responses and existing hooks instead of reaching into runtime services directly.

## Client Components

- Mark interactive components with `"use client"`.
- Keep server-only imports out of client components: no `fs`, database clients, Telegram clients, or config loaders.
- Use `fetchJson()` for console API calls so auth redirects and empty responses are handled consistently.
- Avoid storing duplicate server state across pages unless it belongs in `ConsoleRuntimeProvider`.

## UI Conventions

- Use Ant Design components and existing CSS classes before adding new UI primitives.
- Keep operational pages compact and task-focused; avoid marketing-style layouts.
- Preserve fixed sidebar/header behavior and prevent content flash or layout shift on refresh.

## Tests

Pure helpers belong in `src/components/console/utils.ts` with tests in `utils.test.ts`. For UI behavior, prefer extracting testable functions over brittle DOM tests unless the interaction is high risk.
