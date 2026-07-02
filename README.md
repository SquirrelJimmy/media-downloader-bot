# 媒体下载器

媒体下载器是一个自用的 Telegram 和外部链接媒体下载控制台，基于 Next.js App
Router、TypeScript 和 Ant Design 构建。系统通过 Bot 转发、Telegram 消息直链
和控制台手动任务接收下载请求，写入 SQLite 队列后由 worker 自动下载、记录进度
和保存历史。

核心能力：

- Telegram 媒体、文本消息、HTTP 直链和 yt-dlp 外部视频链接下载
- SQLite + Drizzle 数据库、任务队列、下载记录和进度事件
- 控制台任务管理、下载明细、插件设置、运行配置和单密码登录鉴权
- yt-dlp 二进制检测、下载/更新和个性化参数配置
- rclone 云盘上传、Telegram 转发和运行时服务重启
- Docker 单容器部署、持久化目录和 GHCR 镜像构建工作流

## Commands

```bash
npm install
npm run dev
npm run dev:lan
npm run typecheck
npm run lint
npm run db:migrate
npm run telegram:login
npm run download:configured
npm run bot
npm run listen-forward
npm run worker
```

局域网内其它设备访问控制台时，用局域网绑定脚本启动：

```bash
npm run dev:lan
```

然后在其它设备浏览器打开 `http://<本机局域网IP>:3000`。例如本机 IP
是 `192.168.1.20` 时访问 `http://192.168.1.20:3000`。生产模式可用：

```bash
npm run build
npm run start:lan
```

`next.config.mjs` 已配置 `allowedDevOrigins: ["*"]`，开发模式下允许局域网
来源访问 Next dev server；如果系统防火墙拦截，需要放行 Node.js 或端口
`3000`。

## Docker

默认单容器运行控制台，Next server runtime 会自动启动数据库迁移、Bot、
下载 worker 和 listen-forward。服务监听 `0.0.0.0:3000`：

```bash
docker compose up -d --build
```

也可以在 GitHub Actions 手动运行 `Docker Image` 工作流发布多架构镜像到
GHCR。默认 tag 为 `latest`，镜像地址为：

```bash
docker pull ghcr.io/<owner>/<repo>:latest
```

如果希望 compose 使用远端镜像，可将 `docker-compose.yml` 中的 `image`
临时改为对应 GHCR 地址，或在部署环境另写覆盖文件。

本地开发和生产模式都需要设置控制台密码。可以在 `.env` 中配置：

```dotenv
CONSOLE_PASSWORD=change-me
CONSOLE_SESSION_TTL_DAYS=30
CONSOLE_COOKIE_SECURE=0
```

如果使用 HTTPS 反向代理，可将 `CONSOLE_COOKIE_SECURE` 设置为 `1`。

首次启动会在挂载目录中生成 `config/app.yaml`，所有运行数据都在宿主机持久化：

```text
./config            -> /app/config
./data              -> /app/data
./downloads         -> /app/downloads
./storage/sessions  -> /app/storage/sessions
./storage/tmp       -> /app/storage/tmp
./log               -> /app/log
$HOME/.config/rclone -> /root/.config/rclone
```

如果复用已有 `config/app.yaml`，需要确认下载目录、临时目录、session 目录和
yt-dlp 路径是容器内路径，例如 `/app/downloads`、`/app/storage/tmp`、
`/app/storage/sessions`、`/app/data/bin/yt-dlp_linux`。交互登录可通过：

```bash
docker compose run --rm app npm run telegram:login
```

## Telegram User Client

Set Telegram credentials in `config/app.yaml` or copy from
`config/app.yaml.example`.

```yaml
telegram:
  api_id: 123456
  api_hash: your_api_hash
  sessions_dir: storage/sessions
  user_session: media_downloader.session
  phone: "+10000000000" # optional; CLI will ask if empty
```

Run the interactive login once:

```bash
npm run telegram:login
```

After the mtcute SQLite session file exists, the server can fetch and download
Telegram messages. A copied Pyrogram `.session` file is also SQLite, but its
schema is different and is not treated as a valid mtcute session; run
`npm run telegram:login` once if `/api/status` reports a session warning.

```bash
curl -X POST http://localhost:3000/api/telegram/messages \
  -H 'content-type: application/json' \
  -d '{"chatId":"me","messageId":1}'
```

Messages are stored in the SQLite `task_queue` table. Run `npm run worker` in a
separate process only for debugging. When running the Next.js server
(`npm run dev` or `npm run start`), the worker is auto-started inside the server
runtime and consumes queued jobs from SQLite. `processImmediately: true` is
still available for debugging and runs the download inside the API request.

Queue state is available from:

```bash
curl http://localhost:3000/api/tasks/queue
curl http://localhost:3000/api/status
```

## Configured Chat Downloads

The old `config.yaml chat[]` semantics are available as `chats[]`. The loader
also accepts legacy `chat[]`.

```yaml
chats:
  - chat_id: -1001234567890
    enabled: true
    last_read_message_id: 0
    download_filter: ""
    upload_telegram_chat_id: ""
    limit: 100
    reverse: true
```

Run a configured scan from the CLI:

```bash
npm run download:configured -- --chat -1001234567890 --limit 100
```

Or from the API:

```bash
curl -X POST http://localhost:3000/api/downloads/configured \
  -H 'content-type: application/json' \
  -d '{"chatIds":["-1001234567890"],"limit":100}'
```

Each configured scan traverses Telegram history from the larger of the config
`last_read_message_id` and SQLite `chat_progress.last_read_message_id`, enqueues
messages into `task_queue`, and updates `chat_progress` with scan progress.

## Filter And Bot

`download_filter` supports the migrated core DSL syntax:

```text
media_file_size > 10MB && media_file_name == r'.*\.mp4$'
message_date > 2024-01-01 00:00:00
```

Check expressions through:

```bash
curl -X POST http://localhost:3000/api/filter/check \
  -H 'content-type: application/json' \
  -d '{"expression":"media_file_size > 10MB"}'
```

If `telegram.bot_token` is configured, start the bot with:

```bash
npm run bot
```

When running the Next.js server (`npm run dev` or `npm run start`), the bot is
auto-started inside the server runtime if `telegram.bot_token` is configured.
`npm run bot` is kept as a standalone debugging entrypoint.

Supported bot commands:

```text
/download <t.me link|chatId messageId> [filter]
/scan [chatId] [limit]
/forward <sourceChatId> <targetChatId> [limit] [filter]
/listen_forward <sourceChatId> <targetChatId> [filter]
/status
```

Listen-forward rules are persisted in SQLite. The listen-forward loop is also
auto-started inside the Next.js server runtime; `npm run listen-forward` is kept
as a standalone debugging entrypoint.

```bash
curl -X POST http://localhost:3000/api/forward/listen \
  -H 'content-type: application/json' \
  -d '{"sourceChatId":"-100src","targetChatId":"-100dst","filter":"message_id > 0"}'

```

## Structure

```text
src/app       Next.js pages and API routes
src/components Ant Design console components
src/config    YAML/env config schema and loader
src/db        SQLite/Drizzle schema, client, migration runner
src/engine    task queue, worker, pipeline, runtime status
src/plugins   download plugin interface and built-in plugins
src/cloud     cloud upload adapter interface and rclone adapter
src/filter    filter metadata and DSL boundary
src/utils     formatting, logging, path, URL helpers
src/types     shared task/download types
```
