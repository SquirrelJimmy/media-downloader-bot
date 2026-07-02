#!/bin/sh
set -eu

APP_CONFIG_PATH="${APP_CONFIG_PATH:-/app/config/app.yaml}"

case "$(uname -m)" in
  aarch64|arm64)
    YTDLP_ASSET="yt-dlp_linux_aarch64"
    ;;
  *)
    YTDLP_ASSET="yt-dlp_linux"
    ;;
esac

YTDLP_TARGET="./data/bin/${YTDLP_ASSET}"

mkdir -p \
  "$(dirname "$APP_CONFIG_PATH")" \
  /app/data/bin \
  /app/downloads \
  /app/storage/sessions \
  /app/storage/tmp \
  /app/log

if [ ! -f "$APP_CONFIG_PATH" ]; then
  sed "s#__YTDLP_PATH__#${YTDLP_TARGET}#g" /app/docker/app.yaml.template > "$APP_CONFIG_PATH"
fi

if [ -f "$YTDLP_TARGET" ] && [ ! -x "$YTDLP_TARGET" ]; then
  chmod 0755 "$YTDLP_TARGET"
fi

exec "$@"
