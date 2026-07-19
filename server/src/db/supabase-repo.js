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
