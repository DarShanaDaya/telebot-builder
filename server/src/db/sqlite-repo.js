import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, config } from '../config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_enc TEXT NOT NULL,
  username TEXT,
  mode TEXT NOT NULL DEFAULT 'polling',
  status TEXT NOT NULL DEFAULT 'stopped',
  webhook_secret TEXT NOT NULL,
  flow_draft TEXT,
  flow_published TEXT,
  published_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bots_user ON bots(user_id);
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  data_enc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  user_json TEXT,
  node_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  variables TEXT NOT NULL DEFAULT '{}',
  pending TEXT,
  last_activity TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(bot_id, chat_id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_bot ON sessions(bot_id);
CREATE TABLE IF NOT EXISTS processed_updates (
  bot_id TEXT NOT NULL,
  update_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (bot_id, update_id)
);
CREATE INDEX IF NOT EXISTS idx_processed_updates_created ON processed_updates(created_at);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  chat_id TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  data TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_bot ON logs(bot_id, id);
`;

// SQLite repository backed by the built-in node:sqlite driver — zero native
// dependencies. Implements the same async interface as the Supabase repo.
export function createSqliteRepo() {
  const file = path.join(DATA_DIR, 'telebot.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const repo = {
    provider: 'sqlite',

    // ---- users -----------------------------------------------------------
    async createUser(u) {
      db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
        u.id, u.email, u.name, u.password_hash, u.created_at
      );
      return u;
    },
    async findUserByEmail(email) {
      return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase()) || null;
    },
    async findUserById(id) {
      return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
    },

    // ---- bots ------------------------------------------------------------
    async createBot(b) {
      db.prepare(`INSERT INTO bots (id, user_id, name, token_enc, username, mode, status, webhook_secret,
        flow_draft, flow_published, published_at, last_error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        b.id, b.user_id, b.name, b.token_enc, b.username, b.mode, b.status, b.webhook_secret,
        b.flow_draft, b.flow_published, b.published_at, b.last_error, b.created_at, b.updated_at
      );
      return b;
    },
    async updateBot(id, patch) {
      const keys = Object.keys(patch);
      if (!keys.length) return this.getBot(id);
      const set = keys.map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE bots SET ${set} WHERE id = ?`).run(...keys.map((k) => patch[k]), id);
      return this.getBot(id);
    },
    async deleteBot(id) {
      db.prepare('DELETE FROM sessions WHERE bot_id = ?').run(id);
      db.prepare('DELETE FROM processed_updates WHERE bot_id = ?').run(id);
      db.prepare('DELETE FROM logs WHERE bot_id = ?').run(id);
      db.prepare('DELETE FROM bots WHERE id = ?').run(id);
    },
    async getBot(id) {
      return db.prepare('SELECT * FROM bots WHERE id = ?').get(id) || null;
    },
    async listBots(userId) {
      return db.prepare('SELECT * FROM bots WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    },
    async listRunningBots() {
      return db.prepare("SELECT * FROM bots WHERE status = 'running'").all();
    },

    // ---- credentials -----------------------------------------------------
    async createCredential(c) {
      db.prepare('INSERT INTO credentials (id, user_id, name, type, data_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        c.id, c.user_id, c.name, c.type, c.data_enc, c.created_at, c.updated_at
      );
      return c;
    },
    async updateCredential(id, patch) {
      const keys = Object.keys(patch);
      if (!keys.length) return this.getCredential(id);
      const set = keys.map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE credentials SET ${set} WHERE id = ?`).run(...keys.map((k) => patch[k]), id);
      return this.getCredential(id);
    },
    async deleteCredential(id) {
      db.prepare('DELETE FROM credentials WHERE id = ?').run(id);
    },
    async getCredential(id) {
      return db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) || null;
    },
    async listCredentials(userId) {
      return db.prepare('SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    },

    // ---- sessions --------------------------------------------------------
    async getSession(botId, chatId) {
      return db.prepare('SELECT * FROM sessions WHERE bot_id = ? AND chat_id = ?').get(botId, String(chatId)) || null;
    },
    async upsertSession(s) {
      db.prepare(`INSERT INTO sessions (id, bot_id, chat_id, user_json, node_id, status, variables, pending, last_activity, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(bot_id, chat_id) DO UPDATE SET
          user_json = excluded.user_json,
          node_id = excluded.node_id,
          status = excluded.status,
          variables = excluded.variables,
          pending = excluded.pending,
          last_activity = excluded.last_activity`).run(
        s.id, s.bot_id, String(s.chat_id), s.user_json, s.node_id, s.status, s.variables, s.pending, s.last_activity, s.created_at
      );
      return this.getSession(s.bot_id, s.chat_id);
    },
    async deleteSession(botId, chatId) {
      db.prepare('DELETE FROM sessions WHERE bot_id = ? AND chat_id = ?').run(botId, String(chatId));
    },
    async listSessions(botId) {
      return db.prepare('SELECT * FROM sessions WHERE bot_id = ? ORDER BY last_activity DESC').all(botId);
    },

    // ---- update de-duplication -----------------------------------------
    async claimUpdate(botId, updateId) {
      const result = db.prepare('INSERT OR IGNORE INTO processed_updates (bot_id, update_id, created_at) VALUES (?, ?, ?)').run(
        botId, String(updateId), new Date().toISOString()
      );
      return result.changes === 1;
    },
    async releaseUpdate(botId, updateId) {
      db.prepare('DELETE FROM processed_updates WHERE bot_id = ? AND update_id = ?').run(botId, String(updateId));
    },

    // ---- logs ------------------------------------------------------------
    async addLog(entry) {
      db.prepare('INSERT INTO logs (bot_id, chat_id, level, message, data, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        entry.bot_id, entry.chat_id ?? null, entry.level, entry.message, entry.data ?? null, entry.created_at
      );
      // Retention: keep the latest N entries per bot.
      db.prepare(`DELETE FROM logs WHERE bot_id = ? AND id NOT IN
        (SELECT id FROM logs WHERE bot_id = ? ORDER BY id DESC LIMIT ?)`).run(
        entry.bot_id, entry.bot_id, config.logRetentionPerBot
      );
    },
    async listLogs(botId, { level, limit = 200 } = {}) {
      if (level && level !== 'all') {
        return db.prepare('SELECT * FROM logs WHERE bot_id = ? AND level = ? ORDER BY id DESC LIMIT ?').all(botId, level, limit);
      }
      return db.prepare('SELECT * FROM logs WHERE bot_id = ? ORDER BY id DESC LIMIT ?').all(botId, limit);
    },
    async clearLogs(botId) {
      db.prepare('DELETE FROM logs WHERE bot_id = ?').run(botId);
    },
  };

  return repo;
}
