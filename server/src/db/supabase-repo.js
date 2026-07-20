import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

// Supabase (Postgres) repository implementing the same async interface as the
// SQLite repo. Requires the tables from supabase-schema.sql to exist.
export function createSupabaseRepo({ url, serviceKey }) {
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

  const unwrap = async (promise, what) => {
    const { data, error } = await promise;
    if (error) throw new Error(`Supabase (${what}): ${error.message}`);
    return data;
  };
  const one = (rows) => (rows && rows.length ? rows[0] : null);

  return {
    provider: 'supabase',

    // ---- users ---------------------------------------------------------
    async createUser(u) {
      await unwrap(sb.from('users').insert(u), 'createUser');
      return u;
    },
    async findUserByEmail(email) {
      return one(await unwrap(sb.from('users').select('*').eq('email', String(email).toLowerCase()).limit(1), 'findUserByEmail'));
    },
    async findUserById(id) {
      return one(await unwrap(sb.from('users').select('*').eq('id', id).limit(1), 'findUserById'));
    },

    // ---- bots ----------------------------------------------------------
    async createBot(b) {
      await unwrap(sb.from('bots').insert(b), 'createBot');
      return b;
    },
    async updateBot(id, patch) {
      await unwrap(sb.from('bots').update(patch).eq('id', id), 'updateBot');
      return this.getBot(id);
    },
    async deleteBot(id) {
      await unwrap(sb.from('sessions').delete().eq('bot_id', id), 'deleteBot.sessions');
      await unwrap(sb.from('logs').delete().eq('bot_id', id), 'deleteBot.logs');
      await unwrap(sb.from('bots').delete().eq('id', id), 'deleteBot');
    },
    async getBot(id) {
      return one(await unwrap(sb.from('bots').select('*').eq('id', id).limit(1), 'getBot'));
    },
    async listBots(userId) {
      return unwrap(sb.from('bots').select('*').eq('user_id', userId).order('created_at', { ascending: false }), 'listBots');
    },
    async listRunningBots() {
      return unwrap(sb.from('bots').select('*').eq('status', 'running'), 'listRunningBots');
    },

    // ---- credentials ---------------------------------------------------
    async createCredential(c) {
      await unwrap(sb.from('credentials').insert(c), 'createCredential');
      return c;
    },
    async updateCredential(id, patch) {
      await unwrap(sb.from('credentials').update(patch).eq('id', id), 'updateCredential');
      return this.getCredential(id);
    },
    async deleteCredential(id) {
      await unwrap(sb.from('credentials').delete().eq('id', id), 'deleteCredential');
    },
    async getCredential(id) {
      return one(await unwrap(sb.from('credentials').select('*').eq('id', id).limit(1), 'getCredential'));
    },
    async listCredentials(userId) {
      return unwrap(sb.from('credentials').select('*').eq('user_id', userId).order('created_at', { ascending: false }), 'listCredentials');
    },

    // ---- sessions ------------------------------------------------------
    async getSession(botId, chatId) {
      return one(
        await unwrap(sb.from('sessions').select('*').eq('bot_id', botId).eq('chat_id', String(chatId)).limit(1), 'getSession')
      );
    },
    async upsertSession(s) {
      const row = { ...s, chat_id: String(s.chat_id) };
      await unwrap(sb.from('sessions').upsert(row, { onConflict: 'bot_id,chat_id' }), 'upsertSession');
      return this.getSession(row.bot_id, row.chat_id);
    },
    async deleteSession(botId, chatId) {
      await unwrap(sb.from('sessions').delete().eq('bot_id', botId).eq('chat_id', String(chatId)), 'deleteSession');
    },
    async listSessions(botId) {
      return unwrap(sb.from('sessions').select('*').eq('bot_id', botId).order('last_activity', { ascending: false }), 'listSessions');
    },

    // ---- update de-duplication -----------------------------------------
    async claimUpdate(botId, updateId) {
      const { error } = await sb.from('processed_updates').insert({ bot_id: botId, update_id: String(updateId), created_at: new Date().toISOString() });
      if (!error) return true;
      // PostgreSQL unique_violation: this Telegram update was already claimed.
      if (error.code === '23505') return false;
      throw new Error(`Supabase (claimUpdate): ${error.message}`);
    },
    async releaseUpdate(botId, updateId) {
      await unwrap(sb.from('processed_updates').delete().eq('bot_id', botId).eq('update_id', String(updateId)), 'releaseUpdate');
    },

    // ---- linked Telegram accounts ---------------------------------------
    async upsertSubscriptionTelegramAccount(row) {
      await unwrap(sb.from('subscription_telegram_accounts').upsert(row, { onConflict: 'user_id,telegram_user_id' }), 'upsertSubscriptionTelegramAccount');
      return this.getSubscriptionTelegramAccount(row.user_id, row.telegram_user_id);
    },
    async getSubscriptionTelegramAccount(userId, telegramUserId) { return one(await unwrap(sb.from('subscription_telegram_accounts').select('*').eq('user_id', userId).eq('telegram_user_id', String(telegramUserId)).limit(1), 'getSubscriptionTelegramAccount')); },
    async listSubscriptionTelegramAccounts(userId) { return unwrap(sb.from('subscription_telegram_accounts').select('*').eq('user_id', userId).order('created_at', { ascending: false }), 'listSubscriptionTelegramAccounts'); },

    // ---- subscription connection codes ----------------------------------
    async createSubscriptionConnectionCode(row) { await unwrap(sb.from('subscription_connection_codes').insert(row), 'createSubscriptionConnectionCode'); return this.getSubscriptionConnectionCode(row.id); },
    async getSubscriptionConnectionCode(id) { return one(await unwrap(sb.from('subscription_connection_codes').select('*').eq('id', id).limit(1), 'getSubscriptionConnectionCode')); },
    async getSubscriptionConnectionCodeByHash(codeHash) { return one(await unwrap(sb.from('subscription_connection_codes').select('*').eq('code_hash', codeHash).limit(1), 'getSubscriptionConnectionCodeByHash')); },
    async consumeSubscriptionConnectionCode(codeHash, telegramUserId, now = new Date().toISOString()) {
      const rows = await unwrap(sb.from('subscription_connection_codes').update({ telegram_user_id: String(telegramUserId), used_at: now }).eq('code_hash', codeHash).is('used_at', null).gt('expires_at', now).select(), 'consumeSubscriptionConnectionCode');
      return one(rows);
    },
    async getActiveSubscriptionConnection(userId) {
      return one(await unwrap(sb.from('subscription_telegram_accounts').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(1), 'getActiveSubscriptionConnection'));
    },

    // ---- subscriptions ---------------------------------------------------
    async createSubscriptionChat(row) { await unwrap(sb.from('subscription_chats').insert(row), 'createSubscriptionChat'); return this.getSubscriptionChat(row.id); },
    async getSubscriptionChat(id) { return one(await unwrap(sb.from('subscription_chats').select('*').eq('id', id).limit(1), 'getSubscriptionChat')); },
    async getSubscriptionChatForUser(id, userId) { return one(await unwrap(sb.from('subscription_chats').select('*').eq('id', id).eq('user_id', userId).limit(1), 'getSubscriptionChatForUser')); },
    async listSubscriptionChats(userId) { return unwrap(sb.from('subscription_chats').select('*').eq('user_id', userId).order('created_at', { ascending: false }), 'listSubscriptionChats'); },
    async updateSubscriptionChat(id, patch) { await unwrap(sb.from('subscription_chats').update(patch).eq('id', id), 'updateSubscriptionChat'); return this.getSubscriptionChat(id); },
    async createSubscriptionPlan(row) { await unwrap(sb.from('subscription_plans').insert(row), 'createSubscriptionPlan'); return this.getSubscriptionPlan(row.id); },
    async getSubscriptionPlan(id) { return one(await unwrap(sb.from('subscription_plans').select('*').eq('id', id).limit(1), 'getSubscriptionPlan')); },
    async getSubscriptionPlanForUser(id, userId) {
      return one(await unwrap(sb.from('subscription_plans').select('*, subscription_chats!inner(user_id)').eq('id', id).eq('subscription_chats.user_id', userId).limit(1), 'getSubscriptionPlanForUser'));
    },
    async listSubscriptionPlans(chatId, { activeOnly = false } = {}) {
      let q = sb.from('subscription_plans').select('*').eq('chat_id', chatId).order('created_at', { ascending: false });
      if (activeOnly) q = q.eq('active', true);
      return unwrap(q, 'listSubscriptionPlans');
    },
    async updateSubscriptionPlan(id, patch) { await unwrap(sb.from('subscription_plans').update(patch).eq('id', id), 'updateSubscriptionPlan'); return this.getSubscriptionPlan(id); },
    async createSubscriptionOrder(row) { await unwrap(sb.from('subscription_orders').insert(row), 'createSubscriptionOrder'); return this.getSubscriptionOrder(row.id); },
    async getSubscriptionOrder(id) { return one(await unwrap(sb.from('subscription_orders').select('*').eq('id', id).limit(1), 'getSubscriptionOrder')); },
    async getSubscriptionOrderForUser(id, userId) { return one(await unwrap(sb.from('subscription_orders').select('*').eq('id', id).eq('user_id', userId).limit(1), 'getSubscriptionOrderForUser')); },
    async getSubscriptionOrderByPayload(payload) { return one(await unwrap(sb.from('subscription_orders').select('*').eq('invoice_payload', payload).limit(1), 'getSubscriptionOrderByPayload')); },
    async updateSubscriptionOrder(id, patch) { await unwrap(sb.from('subscription_orders').update(patch).eq('id', id), 'updateSubscriptionOrder'); return this.getSubscriptionOrder(id); },
    async createSubscriptionPayment(row) { await unwrap(sb.from('subscription_payments').insert(row), 'createSubscriptionPayment'); return this.getSubscriptionPayment(row.id); },
    async getSubscriptionPayment(id) { return one(await unwrap(sb.from('subscription_payments').select('*').eq('id', id).limit(1), 'getSubscriptionPayment')); },
    async findSubscriptionPayment(provider, providerPaymentId) { return one(await unwrap(sb.from('subscription_payments').select('*').eq('provider', provider).eq('provider_payment_id', providerPaymentId).limit(1), 'findSubscriptionPayment')); },
    async getSubscriptionPaymentForUser(id, userId) {
      return one(await unwrap(sb.from('subscription_payments').select('*, subscription_orders!inner(user_id)').eq('id', id).eq('subscription_orders.user_id', userId).limit(1), 'getSubscriptionPaymentForUser'));
    },
    async listSubscriptionPaymentsForUser(userId, { chatId, limit = 100 } = {}) {
      let q = sb.from('subscription_payments').select('*, subscription_orders!inner(user_id,chat_id,telegram_user_id,plan_name_snapshot)').eq('subscription_orders.user_id', userId).order('created_at', { ascending: false }).limit(limit);
      if (chatId) q = q.eq('subscription_orders.chat_id', chatId);
      return unwrap(q, 'listSubscriptionPaymentsForUser');
    },
    async updateSubscriptionPayment(id, patch) { await unwrap(sb.from('subscription_payments').update(patch).eq('id', id), 'updateSubscriptionPayment'); return this.getSubscriptionPayment(id); },
    async createSubscriptionEntitlement(row) { await unwrap(sb.from('subscription_entitlements').insert(row), 'createSubscriptionEntitlement'); return this.getSubscriptionEntitlement(row.id); },
    async getSubscriptionEntitlement(id) { return one(await unwrap(sb.from('subscription_entitlements').select('*').eq('id', id).limit(1), 'getSubscriptionEntitlement')); },
    async createSubscriptionInviteLink(row) { await unwrap(sb.from('subscription_invite_links').insert(row), 'createSubscriptionInviteLink'); return one(await unwrap(sb.from('subscription_invite_links').select('*').eq('id', row.id).limit(1), 'getSubscriptionInviteLink')); },
    async getSubscriptionInviteLinkByUrl(inviteLink) { return one(await unwrap(sb.from('subscription_invite_links').select('*').eq('invite_link', inviteLink).limit(1), 'getSubscriptionInviteLinkByUrl')); },
    async updateSubscriptionInviteLink(id, patch) { await unwrap(sb.from('subscription_invite_links').update(patch).eq('id', id), 'updateSubscriptionInviteLink'); return one(await unwrap(sb.from('subscription_invite_links').select('*').eq('id', id).limit(1), 'getSubscriptionInviteLink')); },
    async listSubscriptionInviteLinks(entitlementId) { return unwrap(sb.from('subscription_invite_links').select('*').eq('entitlement_id', entitlementId).order('created_at', { ascending: false }), 'listSubscriptionInviteLinks'); },
    async upsertSubscriptionJob(row) { await unwrap(sb.from('subscription_jobs').upsert(row, { onConflict: 'job_type,entity_id' }), 'upsertSubscriptionJob'); return one(await unwrap(sb.from('subscription_jobs').select('*').eq('job_type', row.job_type).eq('entity_id', row.entity_id).limit(1), 'getSubscriptionJob')); },
    async claimDueSubscriptionJobs(_now, limit = 25, workerId = 'supabase-worker', leaseSeconds = 120) {
      return unwrap(sb.rpc('claim_subscription_jobs', { p_worker_id: workerId, p_limit: limit, p_lease_seconds: leaseSeconds }), 'claimDueSubscriptionJobs');
    },
    async completeSubscriptionJob(id, workerId = 'supabase-worker') {
      await unwrap(sb.from('subscription_jobs').update({ status: 'completed', claimed_at: null, claimed_by: null, lease_until: null }).eq('id', id).eq('claimed_by', workerId), 'completeSubscriptionJob');
    },
    async failSubscriptionJob(id, error, retryAt, workerId = 'supabase-worker') {
      await unwrap(sb.from('subscription_jobs').update({ status: 'pending', claimed_at: null, claimed_by: null, lease_until: null, last_error: String(error).slice(0, 1000), run_at: retryAt }).eq('id', id).eq('claimed_by', workerId), 'failSubscriptionJob');
    },
    async addSubscriptionAuditLog(row) { await unwrap(sb.from('subscription_audit_logs').insert(row), 'addSubscriptionAuditLog'); },
    async getSubscriptionEntitlementForUser(id, userId) {
      return one(await unwrap(sb.from('subscription_entitlements').select('*, subscription_orders!inner(user_id)').eq('id', id).eq('subscription_orders.user_id', userId).limit(1), 'getSubscriptionEntitlementForUser'));
    },
    async getSubscriptionEntitlementByOrder(orderId) { return one(await unwrap(sb.from('subscription_entitlements').select('*').eq('order_id', orderId).limit(1), 'getSubscriptionEntitlementByOrder')); },
    async listSubscriptionEntitlements(chatId) { return unwrap(sb.from('subscription_entitlements').select('*').eq('chat_id', chatId).order('created_at', { ascending: false }), 'listSubscriptionEntitlements'); },
    async listSubscriptionEntitlementsForTelegramUser(telegramUserId) { return unwrap(sb.from('subscription_entitlements').select('*').eq('telegram_user_id', String(telegramUserId)).order('expires_at', { ascending: true, nullsFirst: true }), 'listSubscriptionEntitlementsForTelegramUser'); },
    async updateSubscriptionEntitlement(id, patch) { await unwrap(sb.from('subscription_entitlements').update(patch).eq('id', id), 'updateSubscriptionEntitlement'); return this.getSubscriptionEntitlement(id); },

    // ---- logs ----------------------------------------------------------
    async addLog(entry) {
      await unwrap(
        sb.from('logs').insert({
          bot_id: entry.bot_id,
          chat_id: entry.chat_id ?? null,
          level: entry.level,
          message: entry.message,
          data: entry.data ?? null,
          created_at: entry.created_at,
        }),
        'addLog'
      );
      // Retention: delete everything older than the newest N entries.
      const stale = await unwrap(
        sb.from('logs').select('id').eq('bot_id', entry.bot_id).order('id', { ascending: false })
          .range(config.logRetentionPerBot, config.logRetentionPerBot + 500),
        'addLog.prune'
      );
      if (stale.length) {
        await unwrap(sb.from('logs').delete().in('id', stale.map((r) => r.id)), 'addLog.prune.delete');
      }
    },
    async listLogs(botId, { level, limit = 200 } = {}) {
      let q = sb.from('logs').select('*').eq('bot_id', botId).order('id', { ascending: false }).limit(limit);
      if (level && level !== 'all') q = q.eq('level', level);
      return unwrap(q, 'listLogs');
    },
    async clearLogs(botId) {
      await unwrap(sb.from('logs').delete().eq('bot_id', botId), 'clearLogs');
    },
  };
}
