# V1 技术债说明

以下根目录文件只为本机 V1 回滚/审计保留，不再是 V2 主运行路径：

- `CLAUDE.old.md`、`CLAUDE.backup.md`：旧运行 Prompt。
- `PROJECT_HANDOFF.md`：V1 历史交接记录。
- `scripts/start.sh`、`watchdog.sh`、`inject-reminder.sh`、`cleanup.sh`：macOS LaunchAgent/固定提醒方案。
- `scripts/patch-wechat-acp.sh`、`patch-markdown.sh`、`_patch_markdown.py`：修改 npx/node_modules 的旧补丁。
- `scripts/migrate_json_to_sqlite.js`：早期 JSON 一次性导入器。

V2 使用 `src/app.js`、数据库 Scheduler、官方 wechat-acp inbox/raw agent/stdio 能力，不执行任何补丁脚本。考虑到工作树中这些脚本含用户未提交修改，本次没有粗暴删除；稳定运行一段时间后可整体移出仓库。
