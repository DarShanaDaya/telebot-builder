import crypto from 'node:crypto';
import { db } from '../db/index.js';

export function addPlanDuration(start, value, unit) {
  const date = new Date(start);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid entitlement start date.');
  if (unit === 'days') date.setUTCDate(date.getUTCDate() + value);
  else if (unit === 'weeks') date.setUTCDate(date.getUTCDate() + value * 7);
  else if (unit === 'months') date.setUTCMonth(date.getUTCMonth() + value);
  else throw new Error(`Unsupported plan duration unit: ${unit}`);
  return date.toISOString();
}

export function makeInvoicePayload(orderId) {
  return `subscription:${orderId}`;
}

export async function createPendingOrder(plan, ownerUserId, telegramUserId) {
  if (!plan || !plan.active) throw new Error('Subscription plan is not available.');
  if (plan.currency !== 'XTR') throw new Error('Only Telegram Stars plans are currently supported.');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return db.createSubscriptionOrder({
    id,
    user_id: ownerUserId,
    plan_id: plan.id,
    chat_id: plan.chat_id,
    telegram_user_id: String(telegramUserId),
    status: 'pending',
    invoice_payload: makeInvoicePayload(id),
    plan_name_snapshot: plan.name,
    duration_value_snapshot: plan.duration_value,
    duration_unit_snapshot: plan.duration_unit,
    is_lifetime_snapshot: Boolean(plan.is_lifetime),
    price_snapshot: plan.price_stars,
    currency_snapshot: plan.currency,
    created_at: now,
  });
}

export async function createPendingCryptoOrder(plan, ownerUserId, telegramUserId) {
  if (!plan?.active || !plan.price_fiat_amount || !plan.price_fiat_currency) throw new Error('This plan does not have a crypto price configured.');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return db.createSubscriptionOrder({
    id,
    user_id: ownerUserId,
    plan_id: plan.id,
    chat_id: plan.chat_id,
    telegram_user_id: String(telegramUserId),
    status: 'pending',
    invoice_payload: `crypto:${id}`,
    plan_name_snapshot: plan.name,
    duration_value_snapshot: plan.duration_value,
    duration_unit_snapshot: plan.duration_unit,
    is_lifetime_snapshot: Boolean(plan.is_lifetime),
    price_snapshot: 0,
    currency_snapshot: plan.price_fiat_currency,
    payment_amount_snapshot: plan.price_fiat_amount,
    payment_currency_snapshot: plan.price_fiat_currency,
    created_at: now,
  });
}

export function verifySuccessfulStarsPayment(order, payment, telegramUserId) {
  return Boolean(
    order && order.status === 'pending'
      && String(order.telegram_user_id) === String(telegramUserId)
      && payment?.currency === 'XTR'
      && Number(payment.total_amount) === Number(order.price_snapshot)
      && payment.invoice_payload === order.invoice_payload
      && payment.telegram_payment_charge_id
  );
}

export async function createEntitlementForPaidOrder(order) {
  const now = new Date().toISOString();
  const expires = order.is_lifetime_snapshot
    ? null
    : addPlanDuration(now, order.duration_value_snapshot, order.duration_unit_snapshot);
  let entitlement;
  try {
    entitlement = await db.createSubscriptionEntitlement({
      id: crypto.randomUUID(),
      order_id: order.id,
      chat_id: order.chat_id,
      telegram_user_id: order.telegram_user_id,
      status: 'paid',
      starts_at: now,
      expires_at: expires,
      created_at: now,
      updated_at: now,
    });
  } catch (error) {
    if (!/unique|duplicate|23505/i.test(error.message || '')) throw error;
    entitlement = await db.getSubscriptionEntitlementByOrder(order.id);
    if (!entitlement) throw error;
  }
  if (expires) {
    const expiry = new Date(expires).getTime();
    const jobs = [
      ['reminder_7d', expiry - 7 * 24 * 60 * 60 * 1000],
      ['reminder_3d', expiry - 3 * 24 * 60 * 60 * 1000],
      ['reminder_24h', expiry - 24 * 60 * 60 * 1000],
      ['expire', expiry],
    ];
    for (const [jobType, runAt] of jobs) {
      await db.upsertSubscriptionJob({
        id: crypto.randomUUID(),
        job_type: jobType,
        entity_id: entitlement.id,
        run_at: new Date(Math.max(Date.now(), runAt)).toISOString(),
        created_at: now,
      });
    }
  }
  return entitlement;
}
