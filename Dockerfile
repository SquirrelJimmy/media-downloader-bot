FROM node:24-bookworm-slim AS deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  PORT=3000 \
  APP_CONFIG_PATH=/app/config/app.yaml \
  DATABASE_URL=file:/app/data/app.db

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg rclone zip tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.next/standalone/server.js ./server.js
COPY --from=builder /app/.next/standalone/package.json ./package.json
COPY --from=builder /app/.next/standalone/node_modules ./node_modules
COPY --from=builder /app/.next/standalone/.next ./.next
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/docker/entrypoint.sh ./docker/entrypoint.sh
COPY --from=builder /app/docker/app.yaml.template ./docker/app.yaml.template
RUN chmod 0755 /app/docker/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["tini", "--", "/app/docker/entrypoint.sh"]
CMD ["node", "server.js"]
