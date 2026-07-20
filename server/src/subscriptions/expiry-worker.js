import crypto from 'node:crypto';
import os from 'node:os';
import { db } from '../db/index.js';

const INTERVAL_MS = 30_000;
const WORKER_ID = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
let timer = null;

const reminderText = {
  reminder_7d: 'Your subscription expires in 7 days.',
  reminder_3d: 'Your subscription expires in 3 days.',
  reminder_24h: 'Your subscription expires in 24 hours.',
};

async function removeMember(client, chatId, userId) {
  // Ban then immediately unban: this removes the member while allowing a later
  // purchase to create a fresh invite link.
  await client.banChatMember(chatId, userId);
  await client.unbanChatMember(chatId, userId, true);
}

async function runJob(job, client) {
  const entitlement = await db.getSubscriptionEntitlement(job.entity_id);
  if (!entitlement) return;
  const now = new Date();
  const expires = entitlement.expires_at ? new Date(entitlement.expires_at) : null;

  if (job.job_type.startsWith('reminder_')) {
    if (!expires || expires <= now || !['active', 'invite_issued', 'paid'].includes(entitlement.status)) return;
    await client.sendMessage(entitlement.telegram_user_id, reminderText[job.job_type]);
    await db.addSubscriptionAuditLog({
      chat_id: entitlement.chat_id,
      telegram_user_id: entitlement.telegram_user_id,
      action: job.job_type,
      entity_type: 'entitlement',
      entity_id: entitlement.id,
      created_at: now.toISOString(),
    });
    return;
  }

  if (job.job_type !== 'expire') return;
  if (!expires || expires > now) {
    await db.failSubscriptionJob(job.id, 'Entitlement is not expired yet.', expires?.toISOString() || now.toISOString());
    return false;
  }
  if (['expired', 'revoked'].includes(entitlement.status)) return;

  const chat = await db.getSubscriptionChat(entitlement.chat_id);
  if (!chat) throw new Error('Managed subscription chat no longer exists.');
  await removeMember(client, chat.telegram_chat_id, entitlement.telegram_user_id);

  const links = await db.listSubscriptionInviteLinks(entitlement.id);
  for (const link of links) {
    if (link.status !== 'revoked') {
      await client.revokeChatInviteLink(link.telegram_chat_id, link.invite_link).catch(() => {});
      await db.updateSubscriptionInviteLink(link.id, { status: 'revoked', revoked_at: now.toISOString() });
    }
  }
  await db.updateSubscriptionEntitlement(entitlement.id, {
    status: 'expired',
    removed_at: now.toISOString(),
    updated_at: now.toISOString(),
  });
  await db.addSubscriptionAuditLog({
    chat_id: entitlement.chat_id,
    telegram_user_id: entitlement.telegram_user_id,
    action: 'expired_member_removed',
    entity_type: 'entitlement',
    entity_id: entitlement.id,
    created_at: now.toISOString(),
  });
  await client.sendMessage(entitlement.telegram_user_id, 'Your subscription has expired and your access was removed.');
}

export async function processSubscriptionJobs(client, workerId = WORKER_ID) {
  const jobs = await db.claimDueSubscriptionJobs(new Date().toISOString(), 25, workerId);
  for (const job of jobs) {
    try {
      const completed = await runJob(job, client);
      if (completed !== false) await db.completeSubscriptionJob(job.id, workerId);
    } catch (error) {
      const retryAt = new Date(Date.now() + Math.min(15 * 60 * 1000, 30_000 * (2 ** Math.min(job.attempts, 5)))).toISOString();
      await db.failSubscriptionJob(job.id, error.message, retryAt, workerId);
      console.error(`[subscription-worker] ${job.job_type}/${job.entity_id}: ${error.message}`);
    }
  }
}

export function startSubscriptionWorker(client) {
  if (timer) return;
  timer = setInterval(() => processSubscriptionJobs(client).catch((error) => console.error('[subscription-worker]', error.message)), INTERVAL_MS);
  timer.unref?.();
  processSubscriptionJobs(client).catch((error) => console.error('[subscription-worker]', error.message));
}

export function stopSubscriptionWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
