import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from '../auth/middleware.js';
import { ah, badRequest, notFound, conflict, unprocessable, zodError } from '../lib/http.js';
import { encryptString } from '../lib/crypto.js';
import { TelegramClient } from '../lib/telegram.js';
import { deployBot, stopBot, isRunning, runningInfo } from '../hub/manager.js';
import { makeBotLogger } from '../runtime/engine.js';
import { validateFlow } from './validate.js';
import { config } from '../config.js';
import { rateLimit } from '../lib/rate-limit.js';

const MODES = ['polling', 'webhook'];

const emptyFlow = () => JSON.stringify({
  nodes: [{ id: 'start-1', type: 'start', position: { x: 80, y: 140 }, data: {} }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

const publicBot = (b) => ({
  id: b.id,
  name: b.name,
  username: b.username,
  mode: b.mode,
  status: b.status,
  last_error: b.last_error,
  published_at: b.published_at,
  created_at: b.created_at,
  updated_at: b.updated_at,
  live: isRunning(b.id)
    ? { running: true, startedAt: runningInfo(b.id)?.startedAt || null }
    : { running: false },
});

async function ownedBot(req, id) {
  const bot = await db.getBot(id);
  if (!bot || bot.user_id !== req.user.id) throw notFound('Bot not found');
  return bot;
}

async function checkToken(token) {
  const client = new TelegramClient(token.trim());
  return client.getMe();
}

const FLOW_EXPORT_KIND = 'telebot-builder/flow-export';
const FLOW_EXPORT_VERSION = 1;

function credentialReferenceMap(credentials) {
  const used = new Set();
  const byId = new Map();
  for (const credential of credentials) {
    const base = String(credential.name || credential.id).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'credential';
    let ref = `credential_${base}`;
    let suffix = 2;
    while (used.has(ref)) ref = `credential_${base}_${suffix++}`;
    used.add(ref);
    byId.set(credential.id, { ref, name: credential.name, type: credential.type });
  }
  return byId;
}

function makeFlowExport(flow, credentials) {
  const exportedFlow = JSON.parse(JSON.stringify(flow));
  const byId = credentialReferenceMap(credentials);
  const requirements = [];
  for (const node of exportedFlow.nodes || []) {
    const data = node.data || {};
    if (!data.credentialId) continue;
    const credential = byId.get(data.credentialId);
    delete data.credentialId;
    if (!credential) continue;
    data.credentialRef = credential.ref;
    if (!requirements.some((item) => item.ref === credential.ref)) requirements.push(credential);
  }
  return { kind: FLOW_EXPORT_KIND, schemaVersion: FLOW_EXPORT_VERSION, exportedAt: new Date().toISOString(), flow: exportedFlow, requirements: { credentials: requirements } };
}

async function hydrateImportedFlow(archive, userId, credentialMap = {}) {
  if (!archive || archive.kind !== FLOW_EXPORT_KIND || archive.schemaVersion !== FLOW_EXPORT_VERSION || !archive.flow) {
    throw badRequest('Unsupported flow export. Expected a Telebot Builder flow export version 1.');
  }
  const flow = JSON.parse(JSON.stringify(archive.flow));
  if (!Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) throw badRequest('Imported flow must contain nodes[] and edges[].');
  const credentials = await db.listCredentials(userId);
  const declaredRequirements = Array.isArray(archive.requirements?.credentials) ? archive.requirements.credentials : [];
  const requirements = new Map(declaredRequirements
    .filter((item) => item && typeof item.ref === 'string' && typeof item.name === 'string' && typeof item.type === 'string')
    .map((item) => [item.ref, item]));
  for (const node of flow.nodes) {
    const data = node.data || {};
    if (!data.credentialRef) continue;
    const required = requirements.get(data.credentialRef);
    const explicitlyMappedId = typeof credentialMap?.[data.credentialRef] === 'string' ? credentialMap[data.credentialRef] : null;
    const candidates = credentials.filter((credential) => credential.name === required?.name && credential.type === required?.type);
    const match = explicitlyMappedId
      ? credentials.find((credential) => credential.id === explicitlyMappedId && credential.type === required?.type)
      : candidates.length === 1 ? candidates[0] : null;
    if (!match) {
      const reason = candidates.length > 1 ? 'Multiple matching credentials exist; provide an explicit credential mapping.' : 'Create it before importing.';
      throw unprocessable(`Import requires credential "${required?.name || data.credentialRef}" (${required?.type || 'unknown type'}). ${reason}`);
    }
    data.credentialId = match.id;
    delete data.credentialRef;
  }
  return flow;
}

export function botsRouter() {
  const r = Router();
  const tokenValidationRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: (req) => `${req.ip || 'unknown'}:${req.user?.id || 'anonymous'}` });
  r.use(requireAuth);

  // Validate a BotFather token against Telegram without creating a bot.
  r.post('/validate-token', tokenValidationRateLimit, ah(async (req, res) => {
    const token = String(req.body?.token || '').trim();
    if (!/^\d+:[\w-]{20,}$/.test(token)) {
      return res.status(200).json({ ok: false, error: 'That doesn’t look like a BotFather token (format: 123456:ABC-DEF…).' });
    }
    try {
      const me = await checkToken(token);
      res.json({ ok: true, bot: { id: me.id, username: me.username, name: me.first_name } });
    } catch (err) {
      res.json({ ok: false, error: err.code === 401 ? 'Telegram rejected this token (401 Unauthorized).' : `Could not reach Telegram: ${err.message}` });
    }
  }));

  r.get('/', ah(async (req, res) => {
    const bots = await db.listBots(req.user.id);
    res.json({ bots: bots.map(publicBot) });
  }));

  r.post('/', ah(async (req, res) => {
    const schema = z.object({
      name: z.string().min(1, 'Name is required').max(80),
      token: z.string().min(10, 'BotFather token is required'),
      mode: z.enum(MODES).default('polling'),
      skipValidation: z.boolean().optional().default(false),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw badRequest(zodError(parsed.error));
    const { name, token, mode, skipValidation } = parsed.data;

    let username = null;
    if (!skipValidation) {
      try {
        const me = await checkToken(token);
        username = me.username || null;
      } catch (err) {
        throw badRequest(
          err.code === 401
            ? 'Telegram rejected this token. Double-check it with @BotFather.'
            : `Could not validate token with Telegram (${err.message}). Tick "save anyway" to bypass.`
        );
      }
    }
    const now = new Date().toISOString();
    const bot = {
      id: crypto.randomUUID(),
      user_id: req.user.id,
      name: name.trim(),
      token_enc: encryptString(token.trim()),
      username,
      mode,
      status: 'stopped',
      webhook_secret: crypto.randomUUID(),
      flow_draft: emptyFlow(),
      flow_published: null,
      published_at: null,
      last_error: null,
      created_at: now,
      updated_at: now,
    };
    await db.createBot(bot);
    makeBotLogger(bot.id)('info', `Bot "${bot.name}" created.`);
    res.status(201).json({ bot: publicBot(bot) });
  }));

  r.get('/:id', ah(async (req, res) => {
    res.json({ bot: publicBot(await ownedBot(req, req.params.id)) });
  }));

  r.patch('/:id', ah(async (req, res) => {
    const bot = await ownedBot(req, req.params.id);
    const schema = z.object({
      name: z.string().min(1).max(80).optional(),
      mode: z.enum(MODES).optional(),
      token: z.string().min(10).optional(),
      skipValidation: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw badRequest(zodError(parsed.error));
    if (bot.status === 'running' && (parsed.data.token || parsed.data.mode)) {
      throw conflict('Stop the bot before changing its token or connection mode.');
    }
    const patch = { updated_at: new Date().toISOString() };
    if (parsed.data.name) patch.name = parsed.data.name.trim();
    if (parsed.data.mode) patch.mode = parsed.data.mode;
    if (parsed.data.token) {
      if (!parsed.data.skipValidation) {
        try {
          const me = await checkToken(parsed.data.token);
          patch.username = me.username || null;
        } catch (err) {
          throw badRequest(err.code === 401 ? 'Telegram rejected the new token.' : `Could not validate token (${err.message}).`);
        }
      }
      patch.token_enc = encryptString(parsed.data.token.trim());
    }
    const updated = await db.updateBot(bot.id, patch);
    makeBotLogger(bot.id)('info', 'Bot settings updated.');
    res.json({ bot: publicBot(updated) });
  }));

  r.delete('/:id', ah(async (req, res) => {
    const bot = await ownedBot(req, req.params.id);
    await stopBot(bot.id);
    await db.deleteBot(bot.id);
    res.json({ ok: true });
  }));

  // ---- flow --------------------------------------------------------------
  r.get('/:id/flow', ah(async (req, res) => {
    const bot = await ownedBot(req, req.params.id);
    res.json({
      draft: bot.flow_draft ? JSON.parse(bot.flow_draft) : null,
      published: bot.flow_published ? JSON.parse(bot.flow_published) : null,
      published_at: bot.published_at,
    });
  }));

  // Portable flow exports deliberately exclude bot tokens, credential IDs,
  // credential secrets, sessions, logs, and webhook secrets.
  r.get('/:id/flow/export', ah(async (req, res) => {
    const bot = await ownedBot(req, req.params.id);
    const flow = bot.flow_draft ? JSON.parse(bot.flow_draft) : null;
    if (!flow) throw badRequest('There is no draft flow to export.');
    const archive = makeFlowExport(flow, await db.listCredentials(req.user.id));
    res.setHeader('Content-Disposition', `attachment; filename="telebot-flow-${bot.id}.json"`);
    res.json(archive);
  }));

  // Imports always replace the draft only; a published flow is never changed
  // until the owner explicitly validates and publishes the imported draft.
  r.post('/:id/flow/import', ah(async (req, res) => {
    const bot = await ownedBot(req, req.params.id);
    const flow = await hydrateImportedFlow(req.body?.archive, req.user.id, req.body?.credentialMap);
    if (flow.nodes.length > config.maxFlowNodes) throw badRequest(`Imported flow has too many nodes (max ${config.maxFlowNodes}).`);
    const { errors, warnings } = validateFlow(flow);
    if (errors.length) throw unprocessable('Imported flow has problems that must be fixed before saving.', { errors, warnings });
    await db.updateBot(bot.id, { flow_draft: JSON.stringify(flow), updated_at: new Date().toISOString() });
    makeBotLogger(bot.id)('info', `Imported flow draft (${flow.nodes.length} nodes, ${flow.edges.length} edges).`);
    res.json({ ok: true, flow, warnings });
  }));

  r.put('/:id/flow', ah(async (req, res) => {
    const bot = await ownedBot(req, req.params.id);
    const flow = req.body?.flow;
    if (!flow || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) {
      throw badRequest('Flow must contain nodes[] and edges[].');
    }
    if (flow.nodes.length > 500) throw badRequest('Flow has too many nodes (max 500).');
    await db.updateBot(bot.id, { flow_draft: JSON.stringify(flow), updated_at: new Date().toISOString() });
    res.json({ ok: true, savedAt: new Date().toISOString() });
  }));

  r.post('/:id/flow/validate', ah(async (req, res) => {
    const bot = await ownedBot(req, req.params.id);
    const flow = req.body?.flow ?? (bot.flow_draft ? JSON.parse(bot.flow_draft) : null);
    res.json(validateFlow(flow));
  }));

  r.post('/:id/flow/publish', ah(async (req, res) => {
    const bot = await ownedBot(req, req.params.id);
    const flow = req.body?.flow ?? (bot.flow_draft ? JSON.parse(bot.flow_draft) : null);
    const { errors, warnings } = validateFlow(flow);
    if (errors.length) throw unprocessable('The flow has problems that must be fixed before publishing.', { errors, warnings });
    await db.updateBot(bot.id, {
      flow_draft: JSON.stringify(flow),
      flow_published: JSON.stringify(flow),
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    makeBotLogger(bot.id)('info', `Flow published (${flow.nodes.length} nodes, ${flow.edges.length} edges).`);
    res.json({ ok: true, warnings, published_at: new Date().toISOString() });
  }));

  // ---- runtime -----------------------------------------------------------
  r.post('/:id/deploy', ah(async (req, res) => {
    const bot = await ownedBot(req, req.params.id);
    const mode = req.body?.mode;
    if (mode && MODES.includes(mode) && mode !== bot.mode) {
      await db.updateBot(bot.id, { mode });
      bot.mode = mode;
    }
    if (!bot.flow_published) throw badRequest('Publish the flow before deploying the bot.');
    try {
      await deployBot(bot.id);
    } catch (err) {
      await db.updateBot(bot.id, { last_error: err.message });
      makeBotLogger(bot.id)('error', `Deploy failed: ${err.message}`);
      throw badRequest(`Deploy failed: ${err.message}`);
    }
    makeBotLogger(bot.id)('info', `Bot deployed in ${bot.mode} mode.`);
    res.json({ ok: true, bot: publicBot(await db.getBot(bot.id)) });
  }));

  r.post('/:id/stop', ah(async (req, res) => {
    const bot = await ownedBot(req, req.params.id);
    await stopBot(bot.id);
    makeBotLogger(bot.id)('info', 'Bot stopped.');
    res.json({ ok: true, bot: publicBot(await db.getBot(bot.id)) });
  }));

  // ---- sessions ----------------------------------------------------------
  r.get('/:id/sessions', ah(async (req, res) => {
    const bot = await ownedBot(req, req.params.id);
    const sessions = await db.listSessions(bot.id);
    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        chat_id: s.chat_id,
        user: s.user_json ? JSON.parse(s.user_json) : {},
        node_id: s.node_id,
        status: s.status,
        variables: s.variables ? JSON.parse(s.variables) : {},
        pending: s.pending ? JSON.parse(s.pending) : null,
        last_activity: s.last_activity,
        created_at: s.created_at,
      })),
    });
  }));

  r.delete('/:id/sessions/:chatId', ah(async (req, res) => {
    const bot = await ownedBot(req, req.params.id);
    await db.deleteSession(bot.id, req.params.chatId);
    res.json({ ok: true });
  }));

  // ---- logs ---------------------------------------------------------------
  r.get('/:id/logs', ah(async (req, res) => {
    const bot = await ownedBot(req, req.params.id);
    const logs = await db.listLogs(bot.id, { level: req.query.level, limit: Math.min(Number(req.query.limit) || 200, 500) });
    res.json({ logs });
  }));

  r.delete('/:id/logs', ah(async (req, res) => {
    const bot = await ownedBot(req, req.params.id);
    await db.clearLogs(bot.id);
    res.json({ ok: true });
  }));

  return r;
}
