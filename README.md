# GYM 猫娘健身助理

这是一个运行在 Mac 本地、通过微信 / Clawbot / wechat-acp 接口交互的私人健身助理。它不是 SaaS，也没有网页后台；真正运行的是本地 Node.js 程序、SQLite 数据库、微信机器人 adapter 和 macOS LaunchAgent 定时任务。

Codex / Claude 只是开发工具。开发完成后不需要一直打开 Codex、Claude 或 VS Code。

## 它如何工作

- `src/index.js` 是 CLI 和后台入口。
- `src/gateway/wechat.js` 只负责收发微信消息。
- `src/engine/coach-engine.js` 负责识别意图、调用 services、生成回复。
- `src/services/` 负责体重、饮食、训练、提醒、总结。
- `data/gym.db` 是唯一事实来源。
- `logs/` 记录启动、消息、提醒和错误。

## 本地依赖

- macOS
- Node.js 18+
- npm
- 可选：Clawbot / wechat-acp 或你自己的微信发送脚本

## 安装

```bash
npm install
cp .env.example .env
npm run init-db
npm run health
```

## 配置 .env

微信接口未配置时，系统不会崩溃，会把消息输出到 console 和日志。

```bash
WECHAT_SEND_COMMAND=
WECHAT_INBOX_DIR=
FOOD_VISION_API_KEY=
LLM_API_KEY=
```

如果你有现成的发送脚本，可以把 `WECHAT_SEND_COMMAND` 配成类似：

```bash
WECHAT_SEND_COMMAND=/Users/you/bin/send-wechat-text
```

程序会把最终文本作为最后一个参数传给该命令。Clawbot / wechat-acp 的具体接入点在 `src/gateway/wechat.js` 中替换即可，业务逻辑不要写进 adapter。

## 常用命令

```bash
npm run dev
npm run start
npm run init-db
npm run health
npm run reminder:morning
npm run reminder:lunch
npm run reminder:training
npm run reminder:evening
npm run test:message
npm run test:reminder
```

模拟微信消息：

```bash
node src/index.js message "97.8"
node src/index.js message "午饭：鸡腿饭，一杯无糖拿铁"
node src/index.js message "练完了，卧推22.5 10 9 8，高位下拉52 12 10 9，RPE 8"
node src/index.js reminder training_card
```

## 后台运行

安装 LaunchAgent：

```bash
npm run install-agent
```

卸载：

```bash
npm run uninstall-agent
```

安装后会创建：

- 开机启动主服务
- 07:30 早安体重提醒
- 12:00 午餐提醒
- 17:30 训前提醒
- 18:20 训练卡
- 21:50 晚间总结

## 日志

```bash
tail -f logs/app.log
tail -f logs/error.log
tail -f logs/reminder.log
```

LaunchAgent 日志在 `logs/launchd-*.log` 和 `logs/service.log`。

## 备份

```bash
npm run backup
```

备份文件会写入 `backups/gym_YYYYMMDD_HHMMSS.db`。

## 图片识别

图片识别当前是 adapter 占位。如果未配置，系统会回复“图片识别接口未配置”，不会崩溃。后续把供应商调用接到 `src/llm/food-vision.js` 即可。

## 常见问题

### 数据库未初始化

运行：

```bash
npm run init-db
```

### 微信没发出去

先运行：

```bash
npm run health
```

如果显示微信未配置，说明当前只会输出到 console/logs。配置 `WECHAT_SEND_COMMAND` 或改造 `src/gateway/wechat.js`。

### 提醒重复发送

`reminder_logs` 对 `(event_type, logical_date)` 有唯一约束，同一天同类型提醒会自动跳过。手动测试可加：

```bash
node src/index.js reminder morning_checkin --force
```

### 不想接 LLM

可以不接。当前核心记录、提醒、训练卡、总结都不依赖 LLM。

### Codex / Claude 要一直开着吗

不需要。后台运行依赖 Mac 本地 Node.js 程序和 LaunchAgent，Codex / Claude 只是开发时用。
