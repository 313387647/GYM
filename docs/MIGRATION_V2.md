# GYM Coach V2 迁移说明

## 数据库

V2 使用增量迁移，不删除 V1 表或历史行：

1. v1：保留 `weight_logs`、`meals`、`workouts`、`exercise_sets`、`daily_summary`、`daily_state`。
2. v2：增加幂等字段，以及 `sleep_logs`、`checkins`、`temporary_events`、`events`、`action_receipts`、`schedule_rules`、`reminders`、`memory_items`、`conversation_summaries`、`image_ingestions`、`outbound_messages`。
3. v3：写入最小默认 Schedule Rules；训练日仍由 `plan.json` 决定。
4. v4：训练窗口每天产生候选事件，由 Agent 根据 `plan.json` 动态 send/skip，不把星期写死在规则中。

`npm run migrate` 会先 checkpoint WAL，再在数据库同目录的 `backups/` 创建迁移前副本。迁移失败时事务回滚，不删原库。

## V1 到 V2

- `data/context.json` 降级为调试快照；真实 Context 从 SQLite/时间/计划动态构建。
- shell `curl` MiMo 调用由 `src/integrations/llm/mimoClient.js` 替代。
- `src/tools/*` 和 `scripts/log_*` 是兼容 CLI，内部转调同一批 V2 Services。
- 固定 LaunchAgent/cron 提醒被持久化 Scheduler + Agent Decision 替代。
- wechat-acp 0.10 已原生支持 raw command、stdio、inbox、inject 与 session；V2 不 patch node_modules。

## 回滚

停止 V2，复制最近一个 `backups/gym_coach.pre-migration-*.db` 为新的测试/恢复数据库，先运行 `PRAGMA integrity_check`。不要在 V2 正在写入时直接覆盖活动数据库。
