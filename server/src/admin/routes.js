import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { ah, badRequest, notFound, forbidden, zodError } from '../lib/http.js';
import { toPublicCredential } from '../credentials/service.js';
import { isRunning, runningInfo, stopBot } from '../hub/manager.js';
import { createPlanSchema, updatePlanSchema, publicPlan, publicEntitlement } from '../subscriptions/plan.js';

// Admin-only console. Every route requires a freshly-verified admin session.
// Admins may view, edit, and delete any account and its content (bots,
// credentials, sessions, logs, and subscription data).

function publicAdminUser(u, counts = {}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    is_admin: Boolean(u.is_admin),
    created_at: u.created_at,
    counts: {
      bots: counts.bots || 0,
      credentials: counts.credentials || 0,
      subscription_chats: counts.subscription_chats || 0,
    },
  };
}

function publicAdminBot(b) {
  let draftNodes = 0;
  let publishedNodes = 0;
  try { draftNodes = JSON.parse(b.flow_draft || '{}').nodes?.length || 0; } catch { /* ignore */ }
  try { publishedNodes = JSON.parse(b.flow_published || '{}').nodes?.length || 0; } catch { /* ignore */ }
  return {
    id: b.id,
    user_id: b.user_id,
    owner_email: b.owner_email || null,
    name: b.name,
    username: b.username,
    mode: b.mode,
    status: b.status,
    last_error: b.last_error,
    published_at: b.published_at,
    created_at: b.created_at,
    updated_at: b.updated_at,
    draft_nodes: draftNodes,
    published_nodes: publishedNodes,
    live: isRunning(b.id) ? { running: true, startedAt: runningInfo(b.id)?.startedAt || null } : { running: false },
  };
}

function publicMainSubscription(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    duration_value: row.duration_value,
    duration_unit: row.duration_unit,
    is_lifetime: Boolean(row.is_lifetime),
    price_stars: row.price_stars,
    price_fiat_amount: row.price_fiat_amount,
    price_fiat_currency: row.price_fiat_currency,
    crypto_currency: row.crypto_currency,
    currency: row.currency,
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function adminRouter() {
  const r = Router();
  r.use(requireAuth, requireAdmin);

  // ---------------------------------------------------------------- users --
  r.get('/users', ah(async (_req, res) => {
    const [users, bots, credentials, chats] = await Promise.all([
      db.listUsers(),
      db.listAllBots(),
      db.listAllCredentials(),
      db.listAllSubscriptionChats(),
    ]);
    const counts = {};
    for (const b of bots) counts[b.user_id] = counts[b.user_id] || {};
    for (const b of bots) counts[b.user_id].bots = (counts[b.user_id].bots || 0) + 1;
    for (const c of credentials) counts[c.user_id] = counts[c.user_id] || {};
    for (const c of credentials) counts[c.user_id].credentials = (counts[c.user_id].credentials || 0) + 1;
    for (const c of chats) counts[c.user_id] = counts[c.user_id] || {};
    for (const c of chats) counts[c.user_id].subscription_chats = (counts[c.user_id].subscription_chats || 0) + 1;
    res.json({ users: users.map((u) => publicAdminUser(u, counts[u.id] || {})) });
  }));

  r.get('/users/:id', ah(async (req, res) => {
    const user = await db.findUserById(req.params.id);
    if (!user) throw notFound('User not found');
    const [bots, credentials, chats] = await Promise.all([
      db.listBots(user.id),
      db.listCredentials(user.id),
      db.listSubscriptionChats(user.id),
    ]);
    res.json({
      user: publicAdminUser(user),
      bots: bots.map(publicAdminBot),
      credentials: credentials.map(toPublicCredential),
      subscription_chats: chats.map((c) => ({
        id: c.id,
        telegram_chat_id: c.telegram_chat_id,
        chat_type: c.chat_type,
        title: c.title,
        username: c.username,
        status: c.status,
        created_at: c.created_at,
      })),
    });
  }));

  r.patch('/users/:id', ah(async (req, res) => {
    const user = await db.findUserById(req.params.id);
    if (!user) throw notFound('User not found');
    const parsed = z.object({
      name: z.string().min(1).max(80).optional(),
      is_admin: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw badRequest(zodError(parsed.error));
    const patch = {};
    if (parsed.data.name) patch.name = parsed.data.name.trim();
    if (typeof parsed.data.is_admin === 'boolean') {
      // An admin cannot remove their own admin role (avoids locking everyone out).
      if (req.user.id === user.id && parsed.data.is_admin === false) {
        throw forbidden('You cannot remove your own admin role.');
      }
      patch.is_admin = parsed.data.is_admin;
    }
    const updated = await db.updateUser(user.id, patch);
    res.json({ user: publicAdminUser(updated) });
  }));

  r.delete('/users/:id', ah(async (req, res) => {
    const user = await db.findUserById(req.params.id);
    if (!user) throw notFound('User not found');
    if (req.user.id === user.id) throw forbidden('You cannot delete your own account from the admin console.');
    await db.deleteUser(user.id);
    res.json({ ok: true });
  }));

  // ----------------------------------------------------------------- bots --
  r.get('/bots', ah(async (_req, res) => {
    const bots = await db.listAllBots();
    res.json({ bots: bots.map(publicAdminBot) });
  }));

  r.get('/bots/:id', ah(async (req, res) => {
    const bot = await db.getBot(req.params.id);
    if (!bot) throw notFound('Bot not found');
    const owner = await db.findUserById(bot.user_id);
    const [sessions, logs] = await Promise.all([
      db.listSessions(bot.id),
      db.listLogs(bot.id, { limit: 1 }),
    ]);
    res.json({
      bot: { ...publicAdminBot(bot), owner_email: owner?.email || null },
      sessions_count: sessions.length,
      logs_count: logs.length || 0,
    });
  }));

  r.patch('/bots/:id', ah(async (req, res) => {
    const bot = await db.getBot(req.params.id);
    if (!bot) throw notFound('Bot not found');
    const parsed = z.object({
      name: z.string().min(1).max(80).optional(),
      mode: z.enum(['polling', 'webhook']).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw badRequest(zodError(parsed.error));
    if (bot.status === 'running' && (parsed.data.mode && parsed.data.mode !== bot.mode)) {
      await stopBot(bot.id);
    }
    const patch = { updated_at: new Date().toISOString() };
    if (parsed.data.name) patch.name = parsed.data.name.trim();
    if (parsed.data.mode) patch.mode = parsed.data.mode;
    const updated = await db.updateBot(bot.id, patch);
    res.json({ bot: publicAdminBot(updated) });
  }));

  r.delete('/bots/:id', ah(async (req, res) => {
    const bot = await db.getBot(req.params.id);
    if (!bot) throw notFound('Bot not found');
    await stopBot(bot.id);
    await db.deleteBot(bot.id);
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------- credentials --
  r.get('/credentials', ah(async (_req, res) => {
    const rows = await db.listAllCredentials();
    res.json({ credentials: rows.map((row) => ({ ...toPublicCredential(row), owner_email: row.owner_email || null })) });
  }));

  r.delete('/credentials/:id', ah(async (req, res) => {
    const row = await db.getCredential(req.params.id);
    if (!row) throw notFound('Credential not found');
    await db.deleteCredential(row.id);
    res.json({ ok: true });
  }));

  // ----------------------------------------------------- subscriptions ----
  r.get('/subscriptions', ah(async (_req, res) => {
    const rows = await db.listAllSubscriptionChats();
    const chats = await Promise.all(rows.map(async (c) => {
      const plans = await db.listSubscriptionPlans(c.id, { activeOnly: false });
      return {
        id: c.id,
        owner_email: c.owner_email || null,
        telegram_chat_id: c.telegram_chat_id,
        chat_type: c.chat_type,
        title: c.title,
        username: c.username,
        status: c.status,
        created_at: c.created_at,
        plans_count: plans.length,
      };
    }));
    res.json({ chats });
  }));

  r.get('/subscriptions/chats/:id', ah(async (req, res) => {
    const chat = await db.getSubscriptionChat(req.params.id);
    if (!chat) throw notFound('Subscription chat not found');
    const [plans, entitlements, payments] = await Promise.all([
      db.listSubscriptionPlans(chat.id, { activeOnly: false }),
      db.listSubscriptionEntitlements(chat.id),
      db.listSubscriptionPaymentsForUser(chat.user_id, { chatId: chat.id, limit: 100 }),
    ]);
    res.json({
      chat: {
        id: chat.id,
        user_id: chat.user_id,
        telegram_chat_id: chat.telegram_chat_id,
        chat_type: chat.chat_type,
        title: chat.title,
        username: chat.username,
        status: chat.status,
        permissions: JSON.parse(chat.permissions_json || '{}'),
        created_at: chat.created_at,
        updated_at: chat.updated_at,
      },
      plans: plans.map(publicPlan),
      entitlements: entitlements.map(publicEntitlement),
      payments: payments.map((p) => ({ id: p.id, provider: p.provider, amount: p.amount, currency: p.currency, status: p.status, created_at: p.created_at })),
    });
  }));

  r.patch('/subscriptions/plans/:id', ah(async (req, res) => {
    const plan = await db.getSubscriptionPlan(req.params.id);
    if (!plan) throw notFound('Subscription plan not found');
    const parsed = updatePlanSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(zodError(parsed.error));
    const data = parsed.data;
    const patch = { updated_at: new Date().toISOString() };
    for (const key of ['name', 'description', 'price_stars', 'price_fiat_amount', 'price_fiat_currency', 'crypto_currency', 'active']) {
      if (data[key] !== undefined) patch[key] = data[key];
    }
    if (data.is_lifetime !== undefined) {
      patch.is_lifetime = data.is_lifetime;
      patch.duration_value = data.is_lifetime ? null : data.duration_value ?? plan.duration_value;
      patch.duration_unit = data.is_lifetime ? null : data.duration_unit ?? plan.duration_unit;
    } else if (data.duration_value !== undefined || data.duration_unit !== undefined) {
      patch.duration_value = data.duration_value;
      patch.duration_unit = data.duration_unit;
      patch.is_lifetime = false;
    }
    const updated = await db.updateSubscriptionPlan(plan.id, patch);
    res.json({ plan: publicPlan(updated) });
  }));

  r.delete('/subscriptions/plans/:id', ah(async (req, res) => {
    const plan = await db.getSubscriptionPlan(req.params.id);
    if (!plan) throw notFound('Subscription plan not found');
    const updated = await db.updateSubscriptionPlan(plan.id, { active: false, updated_at: new Date().toISOString() });
    res.json({ plan: publicPlan(updated) });
  }));

  r.delete('/subscriptions/chats/:id', ah(async (req, res) => {
    const chat = await db.getSubscriptionChat(req.params.id);
    if (!chat) throw notFound('Subscription chat not found');
    await db.deleteSubscriptionChat(chat.id);
    res.json({ ok: true });
  }));

  // ----------------------------------------- main (platform) subscription --
  r.get('/subscriptions/main', ah(async (_req, res) => {
    res.json({ subscription: publicMainSubscription(await db.getMainSubscription()) });
  }));

  r.put('/subscriptions/main', ah(async (req, res) => {
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(zodError(parsed.error));
    const data = parsed.data;
    const now = new Date().toISOString();
    const existing = await db.getMainSubscription();
    const row = {
      id: 'main',
      name: data.name,
      description: data.description || '',
      duration_value: data.is_lifetime ? null : data.duration_value,
      duration_unit: data.is_lifetime ? null : data.duration_unit,
      is_lifetime: data.is_lifetime,
      price_stars: data.price_stars,
      price_fiat_amount: data.price_fiat_amount ?? null,
      price_fiat_currency: data.price_fiat_amount !== undefined ? data.price_fiat_currency : null,
      crypto_currency: data.crypto_currency ?? null,
      currency: 'XTR',
      enabled: Boolean(req.body?.enabled ?? true),
      created_at: existing?.created_at || now,
      updated_at: now,
    };
    const saved = await db.upsertMainSubscription(row);
    res.json({ subscription: publicMainSubscription(saved) });
  }));

  return r;
}
