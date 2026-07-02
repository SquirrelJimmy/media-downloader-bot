# App Layer Guidelines

## Scope

This directory owns Next.js App Router pages, layouts, route groups, and API routes. Keep route files thin: parse request input, call typed services from `src/engine`, `src/db`, `src/config`, or utilities, then return a clear `NextResponse`.

## Pages & Layouts

- Console pages live under `src/app/(console)` and should render page components from `src/components/console/pages`.
- Do not put business logic, polling logic, or large UI sections directly into route files.
- Keep `/login` separate from the protected console layout so unauthenticated users never load console data.

## API Routes

- Always set `export const runtime = "nodejs"` for routes that touch SQLite, filesystem, Telegram, yt-dlp, rclone, or other Node-only APIs.
- Do not read or return secrets such as `api_hash`, `bot_token`, console passwords, session contents, or rclone credentials.
- Return structured JSON errors with appropriate status codes. Avoid throwing raw library errors to clients.
- Reuse existing config loaders, queue services, and task services rather than duplicating persistence logic.

## Validation

Add or update colocated route tests when API behavior changes. Run `npm run typecheck`, `npm run lint`, and focused `npm test -- <route.test.ts>` before handing off.
