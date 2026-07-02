# Docker Guidelines

## Scope

This directory contains Docker runtime templates and entrypoint behavior. The production image is a single-container Next.js standalone runtime.

## Runtime Rules

- Do not copy source, tests, local config, downloads, sessions, databases, or generated binaries into the runtime image.
- Keep all mutable data under mounted paths: `/app/config`, `/app/data`, `/app/downloads`, `/app/storage/sessions`, `/app/storage/tmp`, and `/app/log`.
- Do not download yt-dlp during image build or container startup. The console plugin page handles platform-specific install/update.
- Generate `config/app.yaml` only when missing, using safe defaults and container paths.
- Keep `HOSTNAME=0.0.0.0` and `/api/health` compatible with Docker healthchecks.

## Configuration

Require `CONSOLE_PASSWORD` for real use. Do not bake secrets into templates or images.

## Validation

Use `docker compose config` for static checks and `docker build`/`docker compose up` only when Docker behavior changes.
