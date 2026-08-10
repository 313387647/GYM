# GYM Coach 工程协作说明

本文件只约束 Codex/编码 Agent 对仓库进行开发，不是 GYM Coach 的运行时人格 Prompt。

## 项目边界

- GYM Coach 是单用户、SQLite 驱动的微信健康/健身 Life Agent。
- 主模型为 Xiaomi MiMo；第一阶段不引入 OpenAI 或 Anthropic API。
- `wechat-acp` 只是 Transport Adapter，业务逻辑必须留在 `src/agent`、`src/services` 和 `src/repositories`。
- 不操作生产服务器、ShadowPM、生产 PostgreSQL、Nginx 或其他项目。

## 数据安全

- 禁止删除或重建真实 `gym_coach.db`。
- schema 变化必须新增 `src/db/migrations` 中的正式迁移，迁移前备份并在副本演练。
- 测试只能使用临时数据库。
- LLM 不能直接写 SQLite；所有权威数据写入必须经过 Service/Repository。
- 不提交 `.env`、API Key、微信 Token、真实数据库或个人运行数据。

## 工程规则

- Node.js 20+，优先原生 `fetch`，不以 shell/curl 调模型。
- 用户时间统一由 `src/utils/timezone.js` 按 `USER_TIMEZONE` 计算。
- 训练日来自 `plan.json`，不要在日期工具中硬编码。
- 新写操作必须考虑 event/action 幂等。
- Scheduler 只产生持久化事件；是否发消息由 Agent Decision 决定。
- 修改后至少运行 `npm test` 和 `npm run lint`。

## 运行时 Prompt

运行时行为与表达分别位于：

- `prompts/core.md`
- `prompts/coach_policy.md`
- `prompts/safety.md`
- `prompts/personality.md`

不要把猫娘人格、提醒台词或用户健康事实加回本文件。
