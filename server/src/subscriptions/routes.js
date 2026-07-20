import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { requireAuth } from '../auth/middleware.js';
import { ah, badRequest, conflict, notFound, serviceUnavailable, zodError } from '../lib/http.js';
import { TelegramClient } from '../lib/telegram.js';
import { createEntitlementForPaidOrder, createPendingOrder } from './checkout.js';
import { issueEntitlementInvite, getSubscriptionBotClient } from './system-bot.js';
import { getNowPaymentsPayment } from './nowpayments.js';
import { telegramErrorMessage, verifyManagedChat } from './telegram-chat.js';
import { createPlanSchema, publicEntitlement, publicPlan, updatePlanSchema } from './plan.js';

const CONNECTION_TTL_MS = 10 * 60 * 1000;

function hashCode(code) {
  return crypto.createHmac('sha256', config.platformSecret).update(code).digest('hex');
}

function publicPayment(row) {
  return {
    id: row.id,
    order_id: row.order_id,
    provider: row.provider,
    provider_payment_id: row.provider_payment_id,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicChat(row) {
  return {
    id: row.id,
    telegram_chat_id: row.telegram_chat_id,
    chat_type: row.chat_type,
    title: row.title,
    username: row.username,
    status: row.status,
    permissions: JSON.parse(row.permissions_json || '{}'),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function subscriptionClient() {
  if (!config.subscriptionBotToken) {
    throw serviceUnavailable('Subscription management bot is not configured. Set SUBSCRIPTION_BOT_TOKEN.');
  }
  return new TelegramClient(config.subscriptionBotToken);
}

export function subscriptionsRouter() {
  const r = Router();
  r.use(requireAuth);

  r.post('/connections', ah(async (req, res) => {
    const code = crypto.randomBytes(24).toString('base64url');
    const now = new Date();
    const expires = new Date(now.getTime() + CONNECTION_TTL_MS);
    await db.createSubscriptionConnectionCode({
      id: crypto.randomUUID(),
      user_id: req.user.id,
      code_hash: hashCode(code),
      expires_at: expires.toISOString(),
      created_at: now.toISOString(),
    });
    const username = config.subscriptionBotUsername.replace(/^@/, '') || null;
    res.status(201).json({
      code,
      expires_at: expires.toISOString(),
      bot_username: username,
      instruction: username
        ? `Open @${username} and send /connect ${code}`
        : `Open the subscription bot and send /connect ${code}`,
    });
  }));

  r.get('/chats', ah(async (req, res) => {
    const chats = await db.listSubscriptionChats(req.user.id);
    res.json({ chats: chats.map(publicChat) });
  }));

  r.post('/chats', ah(async (req, res) => {
    const parsed = z.object({
      telegram_chat_id: z.union([z.string(), z.number()]).transform(String),
      require_access_removal: z.boolean().optional().default(true),
    }).safeParse(req.body);
    if (!parsed.success) throw badRequest(zodError(parsed.error));

    const connection = await db.getActiveSubscriptionConnection(req.user.id);
    if (!connection) throw conflict('Link your Telegram account with a current connection code before adding a chat.');

    const client = subscriptionClient();
    let verified;
    try {
      verified = await verifyManagedChat(client, {
        chatId: parsed.data.telegram_chat_id,
        telegramUserId: connection.telegram_user_id,
        requireAccessRemoval: parsed.data.require_access_removal,
      });
    } catch (error) {
      throw badRequest(telegramErrorMessage(error));
    }

    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      user_id: req.user.id,
      telegram_chat_id: String(verified.chat.id),
      chat_type: verified.chat.type,
      title: verified.chat.title || verified.chat.first_name || null,
      username: verified.chat.username || null,
      status: 'active',
      permissions_json: JSON.stringify(verified.permissions),
      created_at: now,
      updated_at: now,
    };
    try {
      const created = await db.createSubscriptionChat(row);
      res.status(201).json({ chat: publicChat(created) });
    } catch (error) {
      if (/unique|duplicate|23505/i.test(error.message || '')) throw conflict('This Telegram chat is already connected to your account.');
      throw error;
    }
  }));

  r.post('/chats/:chatId/plans', ah(async (req, res) => {
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(zodError(parsed.error));
    const chat = await db.getSubscriptionChatForUser(req.params.chatId, req.user.id);
    if (!chat) throw notFound('Subscription chat not found.');
    const now = new Date().toISOString();
    const data = parsed.data;
    try {
      const plan = await db.createSubscriptionPlan({
        id: crypto.randomUUID(),
        chat_id: chat.id,
        name: data.name,
        description: data.description,
        duration_value: data.is_lifetime ? null : data.duration_value,
        duration_unit: data.is_lifetime ? null : data.duration_unit,
        is_lifetime: data.is_lifetime,
        price_stars: data.price_stars,
        price_fiat_amount: data.price_fiat_amount ?? null,
        price_fiat_currency: data.price_fiat_amount !== undefined ? data.price_fiat_currency : null,
        crypto_currency: data.crypto_currency ?? null,
        currency: 'XTR',
        active: true,
        created_at: now,
        updated_at: now,
      });
      res.status(201).json({ plan: publicPlan(plan) });
    } catch (error) {
      if (/unique|duplicate|23505/i.test(error.message || '')) throw conflict('A plan with these details already exists.');
      throw error;
    }
  }));

  r.get('/chats/:chatId/plans', ah(async (req, res) => {
    const chat = await db.getSubscriptionChatForUser(req.params.chatId, req.user.id);
    if (!chat) throw notFound('Subscription chat not found.');
    const plans = await db.listSubscriptionPlans(chat.id, { activeOnly: req.query.active === 'true' });
    res.json({ plans: plans.map(publicPlan) });
  }));

  r.patch('/plans/:id', ah(async (req, res) => {
    const parsed = updatePlanSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(zodError(parsed.error));
    const plan = await db.getSubscriptionPlanForUser(req.params.id, req.user.id);
    if (!plan) throw notFound('Subscription plan not found.');
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

  r.delete('/plans/:id', ah(async (req, res) => {
    const plan = await db.getSubscriptionPlanForUser(req.params.id, req.user.id);
    if (!plan) throw notFound('Subscription plan not found.');
    const updated = await db.updateSubscriptionPlan(plan.id, { active: false, updated_at: new Date().toISOString() });
    res.json({ plan: publicPlan(updated) });
  }));

  r.get('/payments/:id', ah(async (req, res) => {
    const payment = await db.getSubscriptionPaymentForUser(req.params.id, req.user.id);
    if (!payment) throw notFound('Payment not found.');
    res.json({ payment: publicPayment(payment) });
  }));

  r.get('/payments', ah(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const payments = await db.listSubscriptionPaymentsForUser(req.user.id, {
      chatId: req.query.chat_id ? String(req.query.chat_id) : undefined,
      limit,
    });
    res.json({ payments: payments.map(publicPayment) });
  }));

  r.post('/payments/:id/refresh', ah(async (req, res) => {
    const local = await db.getSubscriptionPaymentForUser(req.params.id, req.user.id);
    if (!local) throw notFound('Payment not found.');
    if (local.provider !== 'nowpayments') throw badRequest('Only NOWPayments records can be refreshed.');
    const providerPayment = await getNowPaymentsPayment(local.provider_payment_id);
    const status = String(providerPayment.payment_status || 'unknown');
    const now = new Date().toISOString();
    const updated = await db.updateSubscriptionPayment(local.id, { status, raw_event_json: JSON.stringify(providerPayment), updated_at: now });
    if (status === 'finished') {
      const order = await db.getSubscriptionOrder(local.order_id);
      if (order?.status === 'pending') await db.updateSubscriptionOrder(order.id, { status: 'paid', paid_at: now });
      if (order) {
        const entitlement = await db.getSubscriptionEntitlementByOrder(order.id) || await createEntitlementForPaidOrder({ ...order, status: 'pending' });
        const client = getSubscriptionBotClient();
        if (client && !['active', 'invite_issued'].includes(entitlement.status)) await issueEntitlementInvite(order, entitlement, { chat: { id: order.telegram_user_id } }, client);
      }
    }
    res.json({ payment: publicPayment(updated) });
  }));

  r.post('/payments/:id/refund', ah(async (req, res) => {
    const payment = await db.getSubscriptionPaymentForUser(req.params.id, req.user.id);
    if (!payment) throw notFound('Payment not found.');
    if (payment.provider !== 'telegram_stars') throw badRequest('Only Telegram Stars refunds are currently supported.');
    if (payment.status === 'refunded') return res.json({ payment: publicPayment(payment) });
    if (payment.status !== 'paid') throw conflict('Only paid payments can be refunded.');
    const order = await db.getSubscriptionOrder(payment.order_id);
    const client = subscriptionClient();
    try {
      await client.refundStarPayment(order.telegram_user_id, payment.telegram_payment_charge_id || payment.charge_id);
    } catch (error) {
      throw badRequest(telegramErrorMessage(error));
    }
    const now = new Date().toISOString();
    const updated = await db.updateSubscriptionPayment(payment.id, { status: 'refunded', updated_at: now });
    const entitlement = await db.getSubscriptionEntitlementByOrder(order.id);
    if (entitlement && !['expired', 'revoked'].includes(entitlement.status)) {
      const chat = await db.getSubscriptionChatForUser(order.chat_id, req.user.id);
      if (chat) {
        await client.banChatMember(chat.telegram_chat_id, order.telegram_user_id).then(() => client.unbanChatMember(chat.telegram_chat_id, order.telegram_user_id, true)).catch(() => {});
      }
      await db.updateSubscriptionEntitlement(entitlement.id, { status: 'revoked', removed_at: now, updated_at: now });
    }
    await db.updateSubscriptionOrder(order.id, { status: 'refunded' });
    await db.addSubscriptionAuditLog({ user_id: req.user.id, chat_id: order.chat_id, telegram_user_id: order.telegram_user_id, action: 'payment_refunded', entity_type: 'payment', entity_id: payment.id, created_at: now });
    res.json({ payment: publicPayment(updated) });
  }));

  r.post('/chats/:chatId/grant', ah(async (req, res) => {
    const parsed = z.object({ telegram_user_id: z.union([z.string(), z.number()]).transform(String), plan_id: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) throw badRequest(zodError(parsed.error));
    const chat = await db.getSubscriptionChatForUser(req.params.chatId, req.user.id);
    if (!chat) throw notFound('Subscription chat not found.');
    const plan = await db.getSubscriptionPlanForUser(parsed.data.plan_id, req.user.id);
    if (!plan || plan.chat_id !== chat.id || !plan.active) throw notFound('Active subscription plan not found.');
    const client = subscriptionClient();
    const order = await createPendingOrder(plan, req.user.id, parsed.data.telegram_user_id);
    const now = new Date().toISOString();
    await db.updateSubscriptionOrder(order.id, { status: 'paid', paid_at: now });
    await db.createSubscriptionPayment({
      id: crypto.randomUUID(), order_id: order.id, provider: 'manual', provider_payment_id: `manual:${order.id}`,
      status: 'paid', amount: plan.price_stars, currency: 'XTR', charge_id: null,
      raw_event_json: JSON.stringify({ granted_by: req.user.id }), created_at: now, updated_at: now,
    });
    const paidOrder = { ...order, status: 'paid' };
    const entitlement = await createEntitlementForPaidOrder(paidOrder);
    try {
      await issueEntitlementInvite(paidOrder, entitlement, { chat: { id: parsed.data.telegram_user_id } }, client);
    } catch (error) {
      await db.addSubscriptionAuditLog({ user_id: req.user.id, chat_id: chat.id, telegram_user_id: parsed.data.telegram_user_id, action: 'manual_grant_failed', entity_type: 'entitlement', entity_id: entitlement.id, data: JSON.stringify({ error: error.message }), created_at: new Date().toISOString() });
      throw badRequest(`Access grant failed: ${error.message}`);
    }
    await db.addSubscriptionAuditLog({ user_id: req.user.id, chat_id: chat.id, telegram_user_id: parsed.data.telegram_user_id, action: 'manual_grant', entity_type: 'entitlement', entity_id: entitlement.id, created_at: new Date().toISOString() });
    res.status(201).json({ entitlement: publicEntitlement(await db.getSubscriptionEntitlement(entitlement.id)) });
  }));

  r.get('/chats/:chatId/entitlements', ah(async (req, res) => {
    const chat = await db.getSubscriptionChatForUser(req.params.chatId, req.user.id);
    if (!chat) throw notFound('Subscription chat not found.');
    const entitlements = await db.listSubscriptionEntitlements(chat.id);
    res.json({ entitlements: entitlements.map(publicEntitlement) });
  }));

  r.post('/entitlements/:id/revoke', ah(async (req, res) => {
    const entitlement = await db.getSubscriptionEntitlementForUser(req.params.id, req.user.id);
    if (!entitlement) throw notFound('Subscription entitlement not found.');
    if (['expired', 'revoked'].includes(entitlement.status)) {
      return res.json({ entitlement: publicEntitlement(entitlement) });
    }
    const chat = await db.getSubscriptionChatForUser(entitlement.chat_id, req.user.id);
    if (!chat) throw notFound('Subscription chat not found.');
    const client = subscriptionClient();
    try {
      await client.banChatMember(chat.telegram_chat_id, entitlement.telegram_user_id);
      await client.unbanChatMember(chat.telegram_chat_id, entitlement.telegram_user_id, true);
    } catch (error) {
      throw badRequest(telegramErrorMessage(error));
    }
    const now = new Date().toISOString();
    const updated = await db.updateSubscriptionEntitlement(entitlement.id, { status: 'revoked', removed_at: now, updated_at: now });
    const links = await db.listSubscriptionInviteLinks(entitlement.id);
    for (const link of links) {
      if (link.status !== 'revoked') {
        await client.revokeChatInviteLink(link.telegram_chat_id, link.invite_link).catch(() => {});
        await db.updateSubscriptionInviteLink(link.id, { status: 'revoked', revoked_at: now });
      }
    }
    await db.addSubscriptionAuditLog({ user_id: req.user.id, chat_id: chat.id, telegram_user_id: entitlement.telegram_user_id, action: 'manual_revoke', entity_type: 'entitlement', entity_id: entitlement.id, created_at: now });
    res.json({ entitlement: publicEntitlement(updated) });
  }));

  r.get('/chats/:id', ah(async (req, res) => {
    const chat = await db.getSubscriptionChatForUser(req.params.id, req.user.id);
    if (!chat) throw notFound('Subscription chat not found.');
    res.json({ chat: publicChat(chat) });
  }));

  return r;
}
