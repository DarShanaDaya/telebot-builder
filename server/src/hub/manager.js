import { db } from '../db/index.js';
import { config } from '../config.js';
import { decryptString } from '../lib/crypto.js';
import { TelegramClient, Poller } from '../lib/telegram.js';
import { handleUpdate, makeBotLogger } from '../runtime/engine.js';

// ---------------------------------------------------------------------------
// Bot manager: owns live bot instances (client + poller or webhook binding),
// deploys/stops them, and routes every Telegram update into the flow engine
// with a per-chat serialization lock.
// ---------------------------------------------------------------------------

const instances = new Map(); // botId -> { client, poller|null, mode, startedAt }
const chatLocks = new Map(); // `${botId}:${chatId}` -> Promise

export const isRunning = (botId) => instances.has(botId);
export const runningInfo = (botId) => instances.get(botId) || null;

export function decryptToken(bot) {
  return decryptString(bot.token_enc);
}

function chatIdOf(update) {
  return update.message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? 'unknown';
}

// Serialize updates per chat so a fast double-tap doesn't interleave sessions.
export function processUpdate(botId, update) {
  const key = `${botId}:${chatIdOf(update)}`;
  const prev = chatLocks.get(key) || Promise.resolve();
  const task = prev
    .then(() => dispatchUpdate(botId, update))
    .catch((err) => console.error(`[manager] update failed for bot ${botId}:`, err.message));
  chatLocks.set(key, task);
  task.finally(() => {
    if (chatLocks.get(key) === task) chatLocks.delete(key);
  });
  return task;
}

async function dispatchUpdate(botId, update) {
  const bot = await db.getBot(botId);
  if (!bot || bot.status !== 'running') return;
  // Telegram can redeliver webhook/polling updates. Claim the platform update
  // before executing side effects so duplicate deliveries do not replay a flow.
  if (update?.update_id != null) {
    const claimed = await db.claimUpdate(botId, update.update_id);
    if (!claimed) return;
  }
  const inst = instances.get(botId);
  let client = inst?.client;
  if (!client) {
    // Webhook bots keep no poller; lazily build a client so restarts recover.
    try {
      client = new TelegramClient(decryptToken(bot));
    } catch (err) {
      console.error(`[manager] cannot build Telegram client for ${botId}:`, err.message);
      return;
    }
  }
  await handleUpdate({ bot, client, update, log: makeBotLogger(botId) });
}

export async function deployBot(botId) {
  const bot = await db.getBot(botId);
  if (!bot) throw new Error('Bot not found');
  if (config.isServerless && bot.mode !== 'webhook') {
    throw new Error(
      'Long polling requires a long-running server, which serverless hosts (Vercel) cannot provide. ' +
      'Switch this bot to webhook mode (PUBLIC_BASE_URL must be set), or host the backend on a persistent server.'
    );
  }
  await stopBot(botId, { keepStatus: true });

  const token = decryptToken(bot);
  const client = new TelegramClient(token);
  const log = makeBotLogger(botId);

  if (bot.mode === 'webhook') {
    if (!config.publicBaseUrl) {
      throw new Error('PUBLIC_BASE_URL is not configured — webhook mode requires a public HTTPS URL.');
    }
    const url = `${config.publicBaseUrl}/webhooks/telegram/${bot.id}/${bot.webhook_secret}`;
    await client.setWebhook(url);
    instances.set(botId, { client, poller: null, mode: 'webhook', startedAt: new Date().toISOString() });
    log('info', `Webhook registered: ${url}`);
  } else {
    const poller = new Poller(client, (update) => processUpdate(botId, update), (level, msg) => log(level, msg));
    instances.set(botId, { client, poller, mode: 'polling', startedAt: new Date().toISOString() });
    poller.start();
    log('info', 'Long polling started.');
  }
  await db.updateBot(botId, { status: 'running', last_error: null, updated_at: new Date().toISOString() });
  return instances.get(botId);
}

export async function stopBot(botId, { keepStatus = false } = {}) {
  const inst = instances.get(botId);
  if (inst) {
    if (inst.poller) inst.poller.stop();
    if (inst.mode === 'webhook') await inst.client.deleteWebhook().catch(() => {});
    instances.delete(botId);
  }
  if (!keepStatus) {
    await db.updateBot(botId, { status: 'stopped', updated_at: new Date().toISOString() }).catch(() => {});
  }
  return true;
}

// Restart every bot that was running before a server restart.
// No-op on serverless: there is no long-lived process to resume pollers, and
// webhook bots recover their Telegram client lazily per invocation.
export async function initManager() {
  if (config.isServerless) return;
  let bots = [];
  try {
    bots = await db.listRunningBots();
  } catch (err) {
    console.error('[manager] failed to load running bots:', err.message);
    return;
  }
  for (const bot of bots) {
    try {
      await deployBot(bot.id);
      console.log(`[manager] resumed bot "${bot.name}" (${bot.mode})`);
    } catch (err) {
      console.error(`[manager] failed to resume bot "${bot.name}":`, err.message);
      await db.updateBot(bot.id, { last_error: err.message, status: 'stopped' }).catch(() => {});
    }
  }
}

export function shutdownManager() {
  for (const [, inst] of instances) {
    if (inst.poller) inst.poller.stop();
  }
}
