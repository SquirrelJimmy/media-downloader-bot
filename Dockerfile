FROM node:22-bookworm-slim AS deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

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

RUN mkdir -p /opt/yt-dlp \
  && curl -fsSL -o /opt/yt-dlp/yt-dlp_linux https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  && curl -fsSL -o /opt/yt-dlp/yt-dlp_linux_aarch64 https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64 \
  && chmod 0755 /opt/yt-dlp/yt-dlp_linux /opt/yt-dlp/yt-dlp_linux_aarch64

COPY --from=builder /app ./
RUN chmod 0755 /app/docker/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["tini", "--", "/app/docker/entrypoint.sh"]
CMD ["npm", "run", "start:lan"]
