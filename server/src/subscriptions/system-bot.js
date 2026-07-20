import crypto from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { TelegramClient, Poller } from '../lib/telegram.js';
import { createEntitlementForPaidOrder, createPendingCryptoOrder, createPendingOrder, verifySuccessfulStarsPayment } from './checkout.js';
import { createNowPaymentsPayment } from './nowpayments.js';
import { startSubscriptionWorker, stopSubscriptionWorker } from './expiry-worker.js';

let instance = null;

function codeHash(code) {
  return crypto.createHmac('sha256', config.platformSecret).update(code).digest('hex');
}

function connectionCodeFromText(text) {
  const match = String(text || '').trim().match(/^\/connect(?:@\w+)?\s+([A-Za-z0-9_-]{16,128})$/i);
  return match?.[1] || null;
}

function planIdFromText(text) {
  const value = String(text || '').trim();
  const match = value.match(/^\/buy(?:@\w+)?\s+([A-Za-z0-9-]{10,})$/i)
    || value.match(/^\/start(?:@\w+)?\s+(?:plan[_:])?([A-Za-z0-9-]{10,})$/i);
  return match?.[1] || null;
}

function cryptoPlanIdFromText(text) {
  const match = String(text || '').trim().match(/^\/buycrypto(?:@\w+)?\s+([A-Za-z0-9-]{10,})$/i);
  return match?.[1] || null;
}

async function sendPlanInvoice(client, chatId, telegramUserId, planId) {
  const plan = await db.getSubscriptionPlan(planId);
  if (!plan || !plan.active) {
    await client.sendMessage(chatId, 'That subscription plan is unavailable.');
    return true;
  }
  const chat = await db.getSubscriptionChat(plan.chat_id);
  if (!chat || chat.status !== 'active') {
    await client.sendMessage(chatId, 'This subscription is temporarily unavailable.');
    return true;
  }
  const order = await createPendingOrder(plan, chat.user_id, telegramUserId);
  try {
    await client.sendInvoice(chatId, {
      title: plan.name,
      description: plan.description || `Access to ${chat.title || 'the private community'}`,
      payload: order.invoice_payload,
      currency: 'XTR',
      prices: [{ label: plan.name, amount: plan.price_stars }],
      provider_token: '',
    });
  } catch (error) {
    await db.updateSubscriptionOrder(order.id, { status: 'failed' });
    await client.sendMessage(chatId, 'Unable to create the payment invoice. Please try again later.');
  }
  return true;
}

async function sendSubscriptionStatus(message, client) {
  const entitlements = await db.listSubscriptionEntitlementsForTelegramUser(message.from.id);
  const visible = entitlements.filter((item) => ['paid', 'invite_issued', 'active'].includes(item.status));
  if (!visible.length) {
    await client.sendMessage(message.chat.id, 'You do not have any active subscriptions.');
    return true;
  }
  const lines = [];
  for (const entitlement of visible) {
    const chat = await db.getSubscriptionChat(entitlement.chat_id);
    const expiry = entitlement.expires_at ? new Date(entitlement.expires_at).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC' : 'Lifetime';
    lines.push(`${chat?.title || 'Private community'} — ${entitlement.status} — expires: ${expiry}`);
  }
  await client.sendMessage(message.chat.id, `Your subscriptions:\n${lines.join('\n')}`);
  return true;
}

async function sendCryptoInvoice(client, chatId, telegramUserId, planId) {
  const plan = await db.getSubscriptionPlan(planId);
  if (!plan || !plan.active) {
    await client.sendMessage(chatId, 'That subscription plan is unavailable.');
    return true;
  }
  const chat = await db.getSubscriptionChat(plan.chat_id);
  if (!chat || chat.status !== 'active' || !plan.price_fiat_amount) {
    await client.sendMessage(chatId, 'Crypto checkout is not configured for this plan.');
    return true;
  }
  const order = await createPendingCryptoOrder(plan, chat.user_id, telegramUserId);
  try {
    const payment = await createNowPaymentsPayment({
      orderId: order.id,
      amount: plan.price_fiat_amount,
      priceCurrency: plan.price_fiat_currency,
      payCurrency: plan.crypto_currency || 'usdttrc20',
      description: `${plan.name} access`,
    });
    await db.createSubscriptionPayment({
      id: crypto.randomUUID(),
      order_id: order.id,
      provider: 'nowpayments',
      provider_payment_id: String(payment.payment_id),
      status: payment.payment_status || 'waiting',
      amount: payment.pay_amount || plan.price_fiat_amount,
      currency: payment.pay_currency || plan.crypto_currency,
      raw_event_json: JSON.stringify(payment),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const amount = payment.pay_amount || plan.price_fiat_amount;
    const currency = payment.pay_currency || plan.crypto_currency;
    await client.sendMessage(chatId, `Crypto payment created. Send ${amount} ${currency} to:\n${payment.pay_address}\n\nAccess will be sent automatically after blockchain confirmation.`);
  } catch (error) {
    await db.updateSubscriptionOrder(order.id, { status: 'failed' });
    console.error(`[subscription-bot] crypto checkout failed for ${order.id}: ${error.message}`);
    await client.sendMessage(chatId, 'Crypto checkout is temporarily unavailable. Please try again later.');
  }
  return true;
}

async function handleMembershipUpdate(update, client) {
  const memberUpdate = update?.chat_member;
  const joinRequest = update?.chat_join_request;
  const event = memberUpdate || joinRequest;
  if (!event?.invite_link?.invite_link || !event.from?.id) return false;

  const invite = await db.getSubscriptionInviteLinkByUrl(event.invite_link.invite_link);
  const userId = event.from.id;
  const chatId = String(event.chat?.id);
  const entitlement = invite ? await db.getSubscriptionEntitlement(invite.entitlement_id) : null;
  const valid = Boolean(invite && entitlement
    && String(invite.telegram_chat_id) === chatId
    && String(entitlement.telegram_user_id) === String(userId)
    && invite.status === 'issued'
    && entitlement.status === 'invite_issued');

  if (joinRequest) {
    // Do not interfere with ordinary creator-managed join requests. Only
    // decline a request that used one of our tracked subscription links.
    if (!invite) return false;
    if (!valid) {
      await client.declineChatJoinRequest(joinRequest.chat.id, userId);
      return true;
    }
    await client.approveChatJoinRequest(joinRequest.chat.id, userId);
  }
  if (!valid) return true;

  const now = new Date().toISOString();
  await db.updateSubscriptionInviteLink(invite.id, { status: 'used', used_at: now });
  await db.updateSubscriptionEntitlement(entitlement.id, { status: 'active', joined_at: now, updated_at: now });
  return true;
}

async function handlePreCheckout(update, client) {
  const query = update?.pre_checkout_query;
  if (!query) return false;
  const order = await db.getSubscriptionOrderByPayload(query.invoice_payload);
  const valid = Boolean(order && order.status === 'pending'
    && String(order.telegram_user_id) === String(query.from?.id)
    && query.currency === 'XTR'
    && Number(query.total_amount) === Number(order.price_snapshot));
  await client.answerPreCheckoutQuery(query.id, valid, valid ? undefined : 'This order is invalid or has expired. Please start again.');
  return true;
}

export async function issueEntitlementInvite(order, entitlement, message, client) {
  const chat = await db.getSubscriptionChat(order.chat_id);
  if (!chat || chat.status !== 'active') throw new Error('Managed subscription chat is unavailable.');
  const now = new Date().toISOString();
  const invite = await client.createChatInviteLink(chat.telegram_chat_id, {
    name: `order-${order.id.slice(0, 8)}`,
      expire_date: Math.floor(Date.now() / 1000) + 15 * 60,
      member_limit: 1,
      creates_join_request: true,
    });
  await db.createSubscriptionInviteLink({
    id: crypto.randomUUID(),
    entitlement_id: entitlement.id,
    telegram_chat_id: String(chat.telegram_chat_id),
    invite_link: invite.invite_link,
    status: 'issued',
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    created_at: now,
  });
  await db.updateSubscriptionEntitlement(entitlement.id, { status: 'invite_issued', updated_at: now });
  await client.sendMessage(message.chat.id, `Payment received. Your access link is valid for 15 minutes:\n${invite.invite_link}`);
}

async function handleSuccessfulPayment(message, client) {
  const payment = message?.successful_payment;
  if (!payment || !message.from?.id) return false;
  const order = await db.getSubscriptionOrderByPayload(payment.invoice_payload);
  if (!order) {
    await client.sendMessage(message.chat.id, 'We could not find this order. Please contact support before paying again.');
    return true;
  }
  const existing = await db.findSubscriptionPayment('telegram_stars', payment.telegram_payment_charge_id);
  let entitlement = await db.getSubscriptionEntitlementByOrder(order.id);
  if (!existing) {
    if (!verifySuccessfulStarsPayment(order, payment, message.from.id)) {
      await client.sendMessage(message.chat.id, 'We could not verify this payment. Please contact support before paying again.');
      return true;
    }
    const now = new Date().toISOString();
    await db.createSubscriptionPayment({
      id: crypto.randomUUID(),
      order_id: order.id,
      provider: 'telegram_stars',
      provider_payment_id: payment.telegram_payment_charge_id,
      provider_event_id: payment.provider_payment_charge_id || null,
      status: 'paid',
      amount: payment.total_amount,
      currency: payment.currency,
      charge_id: payment.telegram_payment_charge_id,
      raw_event_json: JSON.stringify(payment),
      created_at: now,
      updated_at: now,
    });
    await db.updateSubscriptionOrder(order.id, { status: 'paid', paid_at: now });
    entitlement ||= await createEntitlementForPaidOrder({ ...order, status: 'pending' });
  }
  if (entitlement?.status === 'invite_issued' || entitlement?.status === 'active') return true;
  try {
    await issueEntitlementInvite(order, entitlement, message, client);
  } catch (error) {
    await client.sendMessage(message.chat.id, 'Payment received, but we could not create the access link automatically. Please contact support.');
    throw error;
  }
  return true;
}

export async function handleSubscriptionBotUpdate(update, client) {
  if (await handleMembershipUpdate(update, client)) return true;
  if (await handlePreCheckout(update, client)) return true;
  if (await handleSuccessfulPayment(update?.message, client)) return true;

  const message = update?.message;
  if (!message || message.chat?.type !== 'private' || !message.from?.id) return false;

  if (/^(\/(?:status|my_subscription)(?:@\w+)?|my subscriptions)$/i.test(String(message.text || '').trim())) {
    return sendSubscriptionStatus(message, client);
  }
  if (/^\/paysupport(?:@\w+)?$/i.test(String(message.text || '').trim())) {
    await client.sendMessage(message.chat.id, 'For payment or access support, please contact the service creator or platform support.');
    return true;
  }

  const cryptoPlanId = cryptoPlanIdFromText(message.text);
  if (cryptoPlanId) return sendCryptoInvoice(client, message.chat.id, message.from.id, cryptoPlanId);

  const planId = planIdFromText(message.text);
  if (planId) return sendPlanInvoice(client, message.chat.id, message.from.id, planId);

  const code = connectionCodeFromText(message.text);
  if (!code) {
    if (/^\/start(?:@\w+)?$/i.test(String(message.text || '').trim())) {
      await client.sendMessage(message.chat.id, 'Send /connect CODE from the Telebot Builder dashboard to link your Telegram account.');
      return true;
    }
    return false;
  }

  const connection = await db.consumeSubscriptionConnectionCode(codeHash(code), message.from.id);
  if (!connection) {
    await client.sendMessage(message.chat.id, 'That connection code is invalid, expired, or already used. Generate a new code from the dashboard.');
    return true;
  }
  const now = new Date().toISOString();
  await db.upsertSubscriptionTelegramAccount({
    id: crypto.randomUUID(),
    user_id: connection.user_id,
    telegram_user_id: String(message.from.id),
    created_at: now,
    updated_at: now,
  });
  await client.sendMessage(message.chat.id, 'Telegram account linked. Return to the dashboard and enter the private channel or group chat ID to finish connecting it.');
  return true;
}

export async function initSubscriptionBot() {
  if (!config.subscriptionBotToken || config.isServerless) return null;
  if (instance) return instance;

  const client = new TelegramClient(config.subscriptionBotToken);
  const me = await client.getMe();
  const poller = new Poller(client, (update) => handleSubscriptionBotUpdate(update, client), (level, message) => {
    console[level === 'error' ? 'error' : 'log'](`[subscription-bot] ${message}`);
  }, ['message', 'pre_checkout_query', 'chat_member', 'chat_join_request']);
  instance = { client, poller, me, startedAt: new Date().toISOString() };
  poller.start();
  startSubscriptionWorker(client);
  console.log(`[subscription-bot] started as @${me.username || me.id}`);
  return instance;
}

export function shutdownSubscriptionBot() {
  stopSubscriptionWorker();
  if (!instance) return;
  instance.poller.stop();
  instance = null;
}

export function getSubscriptionBotClient() {
  return instance?.client || null;
}

export function subscriptionBotInfo() {
  return instance ? { running: true, username: instance.me.username || null, startedAt: instance.startedAt } : { running: false };
}
