#!/usr/bin/env node
import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import crypto from 'node:crypto';
import containerModule from '../container.js';
import normalizeModule from '../integrations/wechat/normalizeMessage.js';
import idModule from '../utils/id.js';
import migrateModule from '../db/migrate.js';
import configModule from '../config.js';

const { createContainer } = containerModule;
const { normalizePrompt } = normalizeModule;
const { stableId } = idModule;
const { migrate } = migrateModule;
const { loadConfig } = configModule;

const config = loadConfig();
if (config.migrateOnStart) migrate();
const container = createContainer({ config });
const sessions = new Map();

async function sendText(cx, sessionId, text) {
  if (!text) return;
  await cx.notify(acp.methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  });
}

const app = acp.agent({ name: 'gym-coach-v2' })
  .onRequest('initialize', () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: false } }))
  .onRequest('authenticate', () => ({}))
  .onRequest('session/new', () => {
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { controller: null });
    return { sessionId };
  })
  .onRequest('session/prompt', async (ctx) => {
    const session = sessions.get(ctx.params.sessionId);
    if (!session) throw new Error('Unknown ACP session');
    session.controller?.abort();
    session.controller = new AbortController();
    try {
      const rawText = (ctx.params.prompt || []).filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim();
      const delivery = /^\[GYM_DELIVER:([^\]]+)\]$/.exec(rawText);
      if (delivery) {
        const outbound = container.repositories.eventRepository.outbound(delivery[1]);
        if (outbound && outbound.status !== 'delivered') {
          await sendText(ctx.client, ctx.params.sessionId, outbound.content);
          container.repositories.eventRepository.markOutboundDelivered(outbound.id);
        }
        return { stopReason: 'end_turn' };
      }
      const normalized = normalizePrompt(ctx.params, container.config);
      const event = {
        id: stableId('evt', 'wechat', normalized.messageId),
        type: normalized.type,
        user_id: ctx.params._meta?.wechatUserId || ctx.params.sessionId,
        timestamp: new Date().toISOString(),
        payload: normalized.payload,
      };
      const result = await container.orchestrator.handle(event, { signal: session.controller.signal });
      if (session.controller.signal.aborted) return { stopReason: 'cancelled' };
      await sendText(ctx.client, ctx.params.sessionId, result.response);
      return { stopReason: 'end_turn' };
    } catch (error) {
      if (session.controller.signal.aborted) return { stopReason: 'cancelled' };
      await sendText(ctx.client, ctx.params.sessionId, '这次处理卡住了，数据没有重复写入。稍后再试一次。');
      return { stopReason: 'end_turn' };
    } finally { session.controller = null; }
  })
  .onNotification('session/cancel', (ctx) => sessions.get(ctx.params.sessionId)?.controller?.abort());

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
app.connect(stream);
