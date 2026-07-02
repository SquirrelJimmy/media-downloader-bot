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

## 致谢

感谢 [tangyoha/telegram_media_downloader](https://github.com/tangyoha/telegram_media_downloader)
提供 Telegram 媒体下载领域的功能参考和实践基础。

## 常用命令

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

命令说明：

- `npm run dev`：启动本地开发服务。
- `npm run dev:lan`：绑定 `0.0.0.0`，方便局域网访问。
- `npm run typecheck`：生成 Next.js 路由类型并执行 TypeScript 检查。
- `npm run lint`：执行 ESLint 检查。
- `npm run db:migrate`：执行 SQLite 数据库迁移。
- `npm run telegram:login`：交互式登录 Telegram 用户会话。

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
来源访问 Next.js 开发服务；如果系统防火墙拦截，需要放行 Node.js 或端口
`3000`。

## Docker

默认单容器运行控制台，Next.js 服务运行时会自动启动数据库迁移、Bot、
下载 worker 和 listen-forward。服务监听 `0.0.0.0:3000`：

```bash
docker compose up -d --build
```

也可以在 GitHub Actions 手动运行 `Docker Image` 工作流发布多架构镜像到
GHCR。默认镜像标签为 `latest`，镜像地址为：

```bash
docker pull ghcr.io/<owner>/<repo>:latest
```

如果希望 `docker compose` 使用远端镜像，可将 `docker-compose.yml` 中的 `image`
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
`/app/storage/sessions`、`/app/data/bin/yt-dlp_linux`。

首次使用推荐直接进入控制台：在“配置 > Telegram 配置”填写 `api_id`、
`api_hash`、手机号和 session 路径，点击“登录 Telegram”完成验证码登录。
Docker 镜像不依赖源码 CLI，也不需要进入容器执行交互命令。

## Telegram 用户会话

在 `config/app.yaml` 中配置 Telegram 参数，也可以先从
`config/app.yaml.example` 复制模板后修改。

```yaml
telegram:
  api_id: 123456
  api_hash: your_api_hash
  sessions_dir: storage/sessions
  user_session: media_downloader.session
  phone: "+10000000000"
```

首次使用前在控制台“配置 > Telegram 配置”点击“登录 Telegram”，按弹窗输入
验证码；如果账号启用了二步验证，继续输入二步验证密码。源码本地开发仍保留
`npm run telegram:login` 作为备用调试命令。

生成 mtcute SQLite session 文件后，服务端即可读取并下载 Telegram 消息。
Pyrogram 的 `.session` 文件虽然也是 SQLite，但数据结构不同，不能作为有效的
mtcute session 使用。如果 `/api/status` 提示 session 警告，请执行一次
控制台 Telegram 登录。

如果日志出现 `SQLITE_IOERR_SHORT_READ`、`SQLITE_CORRUPT` 或 `disk I/O error`
并指向 Telegram session，通常是 session 文件损坏或同一个 session 被多个实例同时
写入。处理步骤：

1. 确认只运行一个使用同一 `bot_token` 和 `storage/sessions` 的实例，停止本地 dev、
   旧容器或其它部署。
2. 备份并删除 `storage/sessions/media_downloader.session*`，包括可能存在的
   `-wal`、`-shm` 文件。
3. 在控制台“配置 > Telegram 配置”重新点击“登录 Telegram”，生成新的 mtcute
   session。

不要把同一个 session 文件同时挂载给多个运行实例写入。

```bash
curl -X POST http://localhost:3000/api/telegram/messages \
  -H 'content-type: application/json' \
  -d '{"chatId":"me","messageId":1}'
```

消息会写入 SQLite 的 `task_queue` 表。`npm run worker` 只建议作为独立调试入口。
运行 Next.js 服务（`npm run dev` 或 `npm run start`）时，worker 会在服务运行时
自动启动并消费 SQLite 队列任务。`processImmediately: true` 仍可用于调试，它会
在 API 请求内直接执行下载。

队列状态可通过以下接口查看：

```bash
curl http://localhost:3000/api/tasks/queue
curl http://localhost:3000/api/status
```

## 配置驱动的批量下载

旧版 `config.yaml chat[]` 语义在新配置中对应 `chats[]`，加载器也兼容旧字段
`chat[]`。这个能力会遍历指定 chat 的历史消息并批量入队，频道消息量很大时请谨慎
使用，建议始终设置 `limit`。

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

通过命令行运行一次配置扫描：

```bash
npm run download:configured -- --chat -1001234567890 --limit 100
```

也可以通过 API 触发：

```bash
curl -X POST http://localhost:3000/api/downloads/configured \
  -H 'content-type: application/json' \
  -d '{"chatIds":["-1001234567890"],"limit":100}'
```

每次扫描会从配置中的 `last_read_message_id` 与 SQLite
`chat_progress.last_read_message_id` 中较大的进度开始遍历，将符合条件的消息写入
`task_queue`，并更新 `chat_progress` 记录扫描进度。

## 过滤器与机器人

`download_filter` 支持迁移后的核心 DSL 语法：

```text
media_file_size > 10MB && media_file_name == r'.*\.mp4$'
message_date > 2024-01-01 00:00:00
```

可通过接口检查表达式是否合法：

```bash
curl -X POST http://localhost:3000/api/filter/check \
  -H 'content-type: application/json' \
  -d '{"expression":"media_file_size > 10MB"}'
```

配置 `telegram.bot_token` 后，可单独启动机器人：

```bash
npm run bot
```

运行 Next.js 服务（`npm run dev` 或 `npm run start`）时，如果已配置
`telegram.bot_token`，机器人会在服务运行时自动启动。`npm run bot` 仅保留为独立
调试入口。

机器人支持以下命令：

```text
/download <t.me link|chatId messageId> [filter]
/scan [chatId] [limit]
/forward <sourceChatId> <targetChatId> [limit] [filter]
/listen_forward <sourceChatId> <targetChatId> [filter]
/status
```

监听转发规则会持久化到 SQLite。listen-forward 循环也会在 Next.js 服务运行时自动
启动；`npm run listen-forward` 仅保留为独立调试入口。

```bash
curl -X POST http://localhost:3000/api/forward/listen \
  -H 'content-type: application/json' \
  -d '{"sourceChatId":"-100src","targetChatId":"-100dst","filter":"message_id > 0"}'

```

## 项目结构

```text
src/app        Next.js 页面和 API 路由
src/components Ant Design 控制台组件
src/config     YAML/env 配置 schema 和加载器
src/db         SQLite/Drizzle schema、客户端和迁移入口
src/engine     任务队列、worker、管线和运行状态
src/plugins    下载插件接口和内置插件
src/cloud      云盘上传适配器接口和 rclone 适配器
src/filter     过滤器元数据和 DSL 边界
src/utils      格式化、日志、路径和 URL 工具
src/types      任务和下载相关共享类型
```
