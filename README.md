# GYM Coach V2

GYM Coach 是一个通过微信陪伴单个用户减脂、训练和管理日常状态的私人 AI Life Agent。

它不再是“固定 cron 到点说一句话”，也不依赖 Claude/Codex 充当线上大脑。V2 由应用自己读取真实数据和当天状态，让 Xiaomi MiMo 做意图/决策与自然语言表达，所有正式写入仍由可测试的 Node.js Service 完成。

## 一眼看懂架构

```text
微信
  ↓
wechat-acp（只负责收发和 session）
  ↓ ACP stdio
GYM ACP Adapter（标准化文字/图片）
  ↓
Orchestrator
  ├─ Context Builder：SQLite + 用户时区 + 训练计划 + Memory
  ├─ MiMo Decision：输出经过 Zod 校验的 JSON actions
  ├─ Services/Repositories：幂等写入 SQLite
  ├─ Updated Context：重新读取权威数据
  └─ MiMo Response：生成自然微信回复

Scheduler → 持久化 Reminder → Orchestrator → send / skip / snooze / reschedule
```

核心目录：

- `src/agent/`：Context、决策、action 执行、回复与总编排。
- `src/services/`：饮食、体重、训练、状态、记忆、提醒等业务规则。
- `src/repositories/`：唯一的 SQLite 读写层。
- `src/integrations/llm/`：统一 MiMo Client。
- `src/integrations/vision/`：安全的图片分析入口。
- `src/scheduler/`：Linux/Docker 可运行的持久化 worker。
- `src/acp/`：很薄的 ACP stdio Adapter。
- `prompts/`：核心行为、教练策略、安全与人格分离。
- `src/db/migrations/`：正式 schema migrations。

## 1. 本地安装

要求 Node.js 20+。在 repo 根目录运行：

```bash
npm install
cp .env.example .env
```

打开 `.env`，至少填写：

```dotenv
MIMO_API_KEY=你的Key
MIMO_API_BASE=https://api.xiaomimimo.com/v1
MIMO_TEXT_MODEL=mimo-v2.5
MIMO_VISION_MODEL=mimo-v2.5
USER_TIMEZONE=Asia/Shanghai
```

不要把 `.env` 发给别人或提交到 Git。项目不会把 Key 打到日志，也不会把 Key 拼进 shell 命令。

## 2. 数据库与迁移

V2 继续使用独立 SQLite，不连接生产 PostgreSQL。

- 旧项目本地默认继续使用 repo 根目录的 `gym_coach.db`。
- Docker 默认使用 `/app/data/gym_coach.db`，宿主机映射为 `./data/gym_coach.db`。
- 可通过 `GYM_DB_PATH` 明确指定路径。

升级 schema：

```bash
npm run migrate
```

迁移只做增量变化。开始前会 checkpoint WAL，并在数据库同目录的 `backups/` 生成副本；不会删库重建。细节见 `docs/MIGRATION_V2.md`。

手动备份（服务运行时也可安全使用 SQLite backup）：

```bash
npm run backup
```

恢复时先停服务，不要覆盖正在写入的数据库。建议把备份复制成新的测试路径，设置 `GYM_DB_PATH` 验证后再切换。

## 3. 测试 MiMo

Text 单独测试：

```bash
npm run mimo:text
```

Vision 单独测试：先把测试图片放进安全 inbox，然后运行：

```bash
mkdir -p data/inbox
npm run mimo:vision -- data/inbox/food.jpg
```

模型由 `MIMO_TEXT_MODEL` / `MIMO_VISION_MODEL` 切换。API 入口集中在 `src/integrations/llm/mimoClient.js`；它负责 timeout、有限重试、错误归一化、JSON 校验前解析和 usage/latency 安全日志。

普通单元测试不会调用真实 API、不会花钱：

```bash
npm test
npm run lint
```

手动真实 API integration：

```bash
MIMO_INTEGRATION=1 npm run test:integration
MIMO_INTEGRATION=1 MIMO_TEST_IMAGE="$PWD/data/inbox/food.jpg" npm run test:integration
```

## 4. 启动 GYM Core

```bash
npm start
```

它会运行正式 migration、启动每分钟 scheduler tick，并在 `http://127.0.0.1:3000/health` 提供健康检查。

只启动 Scheduler：

```bash
npm run scheduler
```

只启动 ACP stdio Adapter（通常由 wechat-acp 自动拉起，不需要手动）：

```bash
npm run acp
```

## 5. 连接 wechat-acp

V2 针对官方 `wechat-acp` 0.10.x 的能力设计。官方已经支持 custom raw agent command、ACP stdio、原生 inbox/图片 resource、文件队列 inject 和 session；因此不再 patch `node_modules`。

本地联调可先启动 `npm start`，再在 repo 根目录另开一个终端：

```bash
npx --yes wechat-acp@0.10.0 \
  --instance gym \
  --agent "node src/acp/server.mjs" \
  --cwd "$PWD" \
  --inbox-dir "$PWD/data/inbox" \
  --hide-thoughts
```

第一次会显示二维码。扫码后，微信文字或图片会进入同一个 Orchestrator。图片文件只能从配置允许的 inbox 读取；路径越界会被拒绝。

主动提醒会先落到 SQLite 的 `outbound_messages`。单机联调时 Scheduler 可以使用官方 `inject` 队列；Docker 拓扑则由持有同一 wechat-acp state 的 delivery worker 注入，避免两个容器各自拥有独立登录/session。

```dotenv
WECHAT_ACP_INSTANCE=gym
WECHAT_INJECT_ENABLED=true
```

用户至少先给机器人发过一条消息，wechat-acp 才知道 `last-active-user`。Scheduler 先让 Agent 决定是否发送，再把待发送内容以 `[GYM_DELIVER:id]` 交回 Adapter；重试不会重新执行健康数据 action。

官方项目与参数说明：[formulahendry/wechat-acp](https://github.com/formulahendry/wechat-acp)。

## 6. Scheduler 为什么不会变成固定台词

`schedule_rules` 只定义“何时产生什么事件”，例如 18:00 产生 `workout_window`。Agent 随后读取：

- 今天是否真的计划训练、是否已经训练；
- 睡眠、energy、mood、workload、临时加班/聚餐；
- 最近 RPE 与疲劳；
- 是否刚提醒过。

最后选择 `send`、`skip`、`snooze`、`reschedule`、`cancel` 或 `complete`。Reminder 的 id、状态、时间和原因都在 SQLite；进程重启会恢复超时的 `processing` 项，不靠易丢失的 `setTimeout`。

## 7. 日志怎么看

日志是单行 JSON，输出到 stderr，常用字段包括：

- `event_id`、hash 后的 user id；
- decision/action 数量；
- MiMo model、latency、usage；
- scheduler 与数据库错误码。

不会输出 API Key、微信 Token、Authorization header。Docker 查看：

```bash
docker compose logs -f gym-core
```

## 8. Docker（本阶段只准备，不部署生产）

先确认 `.env` 已配置，再构建：

```bash
docker compose build
docker compose up gym-core
```

`docker-compose.yml` 预先定义了三个服务：

- `gym-core`：HTTP healthcheck、migration 与持久化 Scheduler；它只写 SQLite/outbound queue，不直接操作 wechat-acp state。
- `wechat-bridge`：固定 `wechat-acp@0.10.0`，通过 ACP stdio 直接运行 `node src/acp/server.mjs`，避免 npm 的标准输出混入 ACP 协议流，负责收取微信消息。
- `wechat-delivery-worker`：从同一 SQLite 的 pending outbound queue 有限重试，并通过同一 wechat-acp instance 注入消息。

`gym-data` 持久化 SQLite 与 inbox，`wechat-state` 持久化 wechat-acp 的 HOME/session。bridge 与 delivery worker 同时挂载这两个 volume，instance 均为 `gym`，因此 Scheduler 的提醒不会落到另一份独立登录状态。运行时不使用 `npx` 下载最新版；镜像构建时固定安装 `wechat-acp@0.10.0`。镜像以非 root 用户运行，gym-core 带 healthcheck。

SQLite 的 named volume 可用 `docker volume inspect` 定位；生产部署前应额外配置宿主机备份任务或将 `gym-data` 换为明确的 bind mount。

本阶段没有 SSH 腾讯云、没有修改 Nginx/ShadowPM/PostgreSQL，也没有部署正式服务器。真正上云前还需要确认备份目录、日志轮转、wechat-acp 登录凭据持久化和服务器磁盘权限。

## 9. 常见问题

“MiMo 报 Key 缺失”：检查 `.env` 的 `MIMO_API_KEY`，不要在命令行回显 Key。

“图片被拒绝”：把图片放在 `WECHAT_INBOX_DIR` 内，并确保 `WECHAT_ALLOWED_INBOX_ROOTS` 包含该目录。

“提醒不发”：确认 core 与 wechat-acp 都在运行、instance 都叫 `gym`、用户已发过消息，并检查 `outbound_messages`/`reminders` 状态。

“升级失败”：保留错误日志，不要删库。用迁移前 backup 在新路径运行 `PRAGMA integrity_check`，再定位失败 migration。

“旧脚本还在”：`scripts/log_meal.js` 等只是兼容入口，已转调 V2 Services；macOS LaunchAgent 与 node_modules patch 文件在 `legacy/README.md` 标记为 deprecated，不属于主路径。
