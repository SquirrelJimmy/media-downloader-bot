#!/bin/sh
set -eu

APP_CONFIG_PATH="${APP_CONFIG_PATH:-/app/config/app.yaml}"

mkdir -p \
  "$(dirname "$APP_CONFIG_PATH")" \
  /app/data/bin \
  /app/downloads \
  /app/storage/sessions \
  /app/storage/tmp \
  /app/log

if [ ! -f "$APP_CONFIG_PATH" ]; then
  cp /app/docker/app.yaml.template "$APP_CONFIG_PATH"
fi

exec "$@"
