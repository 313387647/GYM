# GYM Coach V2 重构执行记录

## Phase 0 审计结论

- 历史 schema v1，核心记录为 weight 1、meals 56、workouts 2、exercise sets 16、daily summary 8、daily state 23。
- V1 同时存在 `scripts/*` 与 `src/tools/*`；日期、训练星期、目标统计多处重复。
- 旧 State 在早晨 `meals=0` 时误判 under-eating。
- MiMo Vision 通过 `execSync(curl)` 和明文临时 JSON 调用，异常/重试与图片去重不可靠。
- 运行时建表、SQLite `localtime`、硬编码 `/Users/...`、LaunchAgent/cron/watchdog 与 npx cache patch 不适合 Linux/Docker。
- `AGENTS.md`、`CLAUDE.md` 同时承担人格、工具和工程规则，存在冲突。
- wechat-acp 新版已原生提供 raw agent command、stdio、inbox、inject 和 session resume，无需继续补丁。

## 执行阶段

- [x] Phase 1：测试基线、迁移框架、历史库副本演练与备份。
- [x] Phase 2：统一 MiMo Text/Vision/Structured JSON Client。
- [x] Phase 3：Repositories、Services、action receipt 幂等。
- [x] Phase 4：用户时区、动态 Context、事实型 Daily State。
- [x] Phase 5：Decision → Zod → Actions → Updated Context → Response。
- [x] Phase 6：持久化 Schedule/Reminder、重启恢复、动态通知动作。
- [x] Phase 7：官方 SDK 实现的薄 ACP stdio Adapter。
- [x] Phase 8：兼容 CLI 收口、Prompt 职责拆分、V1 技术债 deprecated。
- [x] Phase 9：Dockerfile、Compose、volume 与 healthcheck。
- [x] Phase 10：单元/integration 测试入口、README 与迁移文档。
