# Repository Guidelines

## Project Structure & Module Organization

This repository is a Next.js App Router application for a self-hosted media downloader. Application routes live in `src/app`, with console pages under `src/app/(console)` and API routes under `src/app/api`. Reusable UI and hooks live in `src/components`, runtime services in `src/engine`, plugin implementations in `src/plugins/builtin`, database schema and queries in `src/db`, configuration parsing in `src/config`, and shared types in `src/types`. Docker assets are in `Dockerfile`, `docker-compose.yml`, and `docker/`. Tests are colocated as `*.test.ts` beside the code they cover.

## Build, Test, and Development Commands

- `npm run dev`: start the local Next.js dev server.
- `npm run dev:lan`: start dev server on `0.0.0.0` for LAN access.
- `npm run build`: create a production build.
- `npm run start:lan`: run the production server on `0.0.0.0`.
- `npm run typecheck`: generate Next route types and run TypeScript checks.
- `npm run lint`: run ESLint.
- `npm test`: run Vitest tests.
- `npm run db:migrate`: apply SQLite migrations.
- `npm run telegram:login`: create or refresh the Telegram user session.

## Coding Style & Naming Conventions

Use TypeScript with strict types and ES modules. Prefer small, focused modules that follow the existing folder boundaries. Components and React providers use PascalCase file exports, hooks use `use-*` naming, and tests use `*.test.ts`. Keep server/runtime logic out of client components. Use existing utilities before adding new abstractions. Run `npm run lint` and `npm run typecheck` before submitting changes.

## Testing Guidelines

Vitest is the test runner. Add focused unit tests for config parsing, queue behavior, plugin behavior, API routes, and runtime services when those areas change. Keep tests deterministic; avoid real Telegram, network, or Docker dependencies in unit tests. Use mocks or temporary directories for filesystem behavior.

## Commit & Pull Request Guidelines

Use Conventional Commits, as in `ci: add GHCR Docker image workflow` or `docs: update project overview`. Pull requests should include a short summary, validation commands run, and screenshots for visible console UI changes. Mention any config, database, Docker, or runtime behavior changes explicitly.

## Security & Configuration Tips

Never commit real `.env*`, `config/app.yaml`, SQLite databases, Telegram `.session` files, downloads, logs, or generated binaries. Use `config/app.yaml.example` and `.env.example` for placeholders only. Keep `CONSOLE_PASSWORD` set in local and production environments. Treat Bot tokens, API hashes, sessions, and rclone credentials as secrets.
