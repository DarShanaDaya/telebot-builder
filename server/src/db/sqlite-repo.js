import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, config } from '../config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS subscription_chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  chat_type TEXT NOT NULL,
  title TEXT,
  username TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  permissions_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, telegram_chat_id)
);
CREATE INDEX IF NOT EXISTS idx_subscription_chats_user ON subscription_chats(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_chats_telegram ON subscription_chats(telegram_chat_id);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  duration_value INTEGER,
  duration_unit TEXT,
  is_lifetime INTEGER NOT NULL DEFAULT 0,
  price_stars INTEGER,
  price_fiat_amount REAL,
  price_fiat_currency TEXT,
  crypto_currency TEXT,
  currency TEXT NOT NULL DEFAULT 'XTR',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_chat ON subscription_plans(chat_id);

CREATE TABLE IF NOT EXISTS subscription_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  telegram_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  invoice_payload TEXT NOT NULL UNIQUE,
  plan_name_snapshot TEXT NOT NULL,
  duration_value_snapshot INTEGER,
  duration_unit_snapshot TEXT,
  is_lifetime_snapshot INTEGER NOT NULL DEFAULT 0,
  price_snapshot INTEGER NOT NULL,
  currency_snapshot TEXT NOT NULL,
  payment_amount_snapshot REAL,
  payment_currency_snapshot TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_subscription_orders_user ON subscription_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_orders_customer ON subscription_orders(telegram_user_id);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  provider_event_id TEXT,
  status TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  charge_id TEXT,
  raw_event_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_payment_id),
  UNIQUE(provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_order ON subscription_payments(order_id);

CREATE TABLE IF NOT EXISTS subscription_entitlements (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL,
  telegram_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  starts_at TEXT,
  expires_at TEXT,
  joined_at TEXT,
  removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscription_entitlements_chat_user ON subscription_entitlements(chat_id, telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_entitlements_expiry ON subscription_entitlements(status, expires_at);

CREATE TABLE IF NOT EXISTS subscription_invite_links (
  id TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  invite_link TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'issued',
  expires_at TEXT,
  used_at TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_subscription_invites_entitlement ON subscription_invite_links(entitlement_id);

CREATE TABLE IF NOT EXISTS subscription_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  run_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  claimed_by TEXT,
  lease_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(job_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_subscription_jobs_due ON subscription_jobs(status, run_at);

CREATE TABLE IF NOT EXISTS subscription_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  chat_id TEXT,
  telegram_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  data TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscription_audit_user ON subscription_audit_logs(user_id, id);

CREATE TABLE IF NOT EXISTS subscription_connection_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  telegram_user_id TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscription_connection_codes_user ON subscription_connection_codes(user_id, expires_at);

CREATE TABLE IF NOT EXISTS subscription_telegram_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  telegram_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, telegram_user_id)
);
CREATE INDEX IF NOT EXISTS idx_subscription_telegram_accounts_user ON subscription_telegram_accounts(user_id);
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

CREATE TABLE IF NOT EXISTS main_subscription (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  duration_value INTEGER,
  duration_unit TEXT,
  is_lifetime INTEGER NOT NULL DEFAULT 0,
  price_stars INTEGER,
  price_fiat_amount REAL,
  price_fiat_currency TEXT,
  crypto_currency TEXT,
  currency TEXT NOT NULL DEFAULT 'XTR',
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

// SQLite repository backed by the built-in node:sqlite driver — zero native
// dependencies. Implements the same async interface as the Supabase repo.
export function createSqliteRepo() {
  const file = path.join(DATA_DIR, 'telebot.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  // Additive migrations for SQLite databases created before multi-provider
  // pricing was introduced. SQLite has no IF NOT EXISTS for ADD COLUMN.
  for (const statement of [
    'ALTER TABLE subscription_plans ADD COLUMN price_fiat_amount REAL',
    'ALTER TABLE subscription_plans ADD COLUMN price_fiat_currency TEXT',
    'ALTER TABLE subscription_plans ADD COLUMN crypto_currency TEXT',
    'ALTER TABLE subscription_orders ADD COLUMN payment_amount_snapshot REAL',
    'ALTER TABLE subscription_orders ADD COLUMN payment_currency_snapshot TEXT',
    'ALTER TABLE subscription_jobs ADD COLUMN claimed_by TEXT',
    'ALTER TABLE subscription_jobs ADD COLUMN lease_until TEXT',
    'ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0',
  ]) {
    try { db.exec(statement); } catch (error) {
      if (!/duplicate column name/i.test(error.message || '')) throw error;
    }
  }

  const repo = {
    provider: 'sqlite',

    // ---- users -----------------------------------------------------------
    async createUser(u) {
      db.prepare('INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        u.id, u.email, u.name, u.password_hash, u.is_admin ? 1 : 0, u.created_at
      );
      return u;
    },
    async updateUser(id, patch) {
      const keys = Object.keys(patch);
      if (!keys.length) return this.findUserById(id);
      const normalized = { ...patch };
      if ('is_admin' in normalized) normalized.is_admin = normalized.is_admin ? 1 : 0;
      const set = keys.map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE users SET ${set} WHERE id = ?`).run(...keys.map((k) => normalized[k]), id);
      return this.findUserById(id);
    },
    async listUsers() {
      return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
    },
    async deleteUser(id) {
      const bots = db.prepare('SELECT id FROM bots WHERE user_id = ?').all(id);
      for (const b of bots) await this.deleteBot(b.id);
      db.prepare('DELETE FROM credentials WHERE user_id = ?').run(id);
      const chats = db.prepare('SELECT id FROM subscription_chats WHERE user_id = ?').all(id);
      for (const c of chats) await this.deleteSubscriptionChat(c.id);
      db.prepare('DELETE FROM subscription_telegram_accounts WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM subscription_connection_codes WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
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

    // ---- linked Telegram accounts ---------------------------------------
    async upsertSubscriptionTelegramAccount(row) {
      db.prepare(`INSERT INTO subscription_telegram_accounts
        (id, user_id, telegram_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, telegram_user_id) DO UPDATE SET updated_at = excluded.updated_at`).run(
        row.id, row.user_id, String(row.telegram_user_id), row.created_at, row.updated_at
      );
      return this.getSubscriptionTelegramAccount(row.user_id, row.telegram_user_id);
    },
    async getSubscriptionTelegramAccount(userId, telegramUserId) {
      return db.prepare('SELECT * FROM subscription_telegram_accounts WHERE user_id = ? AND telegram_user_id = ?').get(userId, String(telegramUserId)) || null;
    },
    async listSubscriptionTelegramAccounts(userId) {
      return db.prepare('SELECT * FROM subscription_telegram_accounts WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    },

    // ---- subscription connection codes ----------------------------------
    async createSubscriptionConnectionCode(row) {
      db.prepare(`INSERT INTO subscription_connection_codes
        (id, user_id, code_hash, telegram_user_id, expires_at, used_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        row.id, row.user_id, row.code_hash, row.telegram_user_id ?? null, row.expires_at,
        row.used_at ?? null, row.created_at
      );
      return this.getSubscriptionConnectionCode(row.id);
    },
    async getSubscriptionConnectionCode(id) {
      return db.prepare('SELECT * FROM subscription_connection_codes WHERE id = ?').get(id) || null;
    },
    async getSubscriptionConnectionCodeByHash(codeHash) {
      return db.prepare('SELECT * FROM subscription_connection_codes WHERE code_hash = ?').get(codeHash) || null;
    },
    async consumeSubscriptionConnectionCode(codeHash, telegramUserId, now = new Date().toISOString()) {
      const result = db.prepare(`UPDATE subscription_connection_codes
        SET telegram_user_id = ?, used_at = ?
        WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`).run(
        String(telegramUserId), now, codeHash, now
      );
      return result.changes === 1 ? this.getSubscriptionConnectionCodeByHash(codeHash) : null;
    },
    async getActiveSubscriptionConnection(userId) {
      return db.prepare(`SELECT * FROM subscription_telegram_accounts
        WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`).get(userId) || null;
    },

    // ---- subscriptions ---------------------------------------------------
    async createSubscriptionChat(row) {
      db.prepare(`INSERT INTO subscription_chats
        (id, user_id, telegram_chat_id, chat_type, title, username, status, permissions_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        row.id, row.user_id, String(row.telegram_chat_id), row.chat_type, row.title ?? null,
        row.username ?? null, row.status ?? 'active', row.permissions_json ?? '{}', row.created_at, row.updated_at
      );
      return this.getSubscriptionChat(row.id);
    },
    async getSubscriptionChat(id) {
      return db.prepare('SELECT * FROM subscription_chats WHERE id = ?').get(id) || null;
    },
    async getSubscriptionChatForUser(id, userId) {
      return db.prepare('SELECT * FROM subscription_chats WHERE id = ? AND user_id = ?').get(id, userId) || null;
    },
    async listSubscriptionChats(userId) {
      return db.prepare('SELECT * FROM subscription_chats WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    },
    async updateSubscriptionChat(id, patch) {
      const keys = Object.keys(patch);
      if (!keys.length) return this.getSubscriptionChat(id);
      db.prepare(`UPDATE subscription_chats SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => patch[k]), id);
      return this.getSubscriptionChat(id);
    },
    async createSubscriptionPlan(row) {
      db.prepare(`INSERT INTO subscription_plans
        (id, chat_id, name, description, duration_value, duration_unit, is_lifetime, price_stars, price_fiat_amount, price_fiat_currency, crypto_currency, currency, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        row.id, row.chat_id, row.name, row.description ?? null, row.duration_value ?? null,
        row.duration_unit ?? null, row.is_lifetime ? 1 : 0, row.price_stars ?? null,
        row.price_fiat_amount ?? null, row.price_fiat_currency ?? null, row.crypto_currency ?? null,
        row.currency ?? 'XTR', row.active === false ? 0 : 1, row.created_at, row.updated_at
      );
      return this.getSubscriptionPlan(row.id);
    },
    async getSubscriptionPlan(id) {
      return db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(id) || null;
    },
    async getSubscriptionPlanForUser(id, userId) {
      return db.prepare(`SELECT p.* FROM subscription_plans p
        JOIN subscription_chats c ON c.id = p.chat_id
        WHERE p.id = ? AND c.user_id = ?`).get(id, userId) || null;
    },
    async listSubscriptionPlans(chatId, { activeOnly = false } = {}) {
      return db.prepare(`SELECT * FROM subscription_plans WHERE chat_id = ? ${activeOnly ? 'AND active = 1' : ''} ORDER BY created_at DESC`).all(chatId);
    },
    async updateSubscriptionPlan(id, patch) {
      const normalized = { ...patch };
      if ('is_lifetime' in normalized) normalized.is_lifetime = normalized.is_lifetime ? 1 : 0;
      if ('active' in normalized) normalized.active = normalized.active ? 1 : 0;
      const keys = Object.keys(normalized);
      if (!keys.length) return this.getSubscriptionPlan(id);
      db.prepare(`UPDATE subscription_plans SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => normalized[k]), id);
      return this.getSubscriptionPlan(id);
    },
    async createSubscriptionOrder(row) {
      db.prepare(`INSERT INTO subscription_orders
        (id, user_id, plan_id, chat_id, telegram_user_id, status, invoice_payload, plan_name_snapshot,
         duration_value_snapshot, duration_unit_snapshot, is_lifetime_snapshot, price_snapshot, currency_snapshot,
         payment_amount_snapshot, payment_currency_snapshot, created_at, paid_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        row.id, row.user_id, row.plan_id, row.chat_id, String(row.telegram_user_id), row.status ?? 'pending',
        row.invoice_payload, row.plan_name_snapshot, row.duration_value_snapshot ?? null,
        row.duration_unit_snapshot ?? null, row.is_lifetime_snapshot ? 1 : 0, row.price_snapshot,
        row.currency_snapshot, row.payment_amount_snapshot ?? null, row.payment_currency_snapshot ?? null,
        row.created_at, row.paid_at ?? null
      );
      return this.getSubscriptionOrder(row.id);
    },
    async getSubscriptionOrder(id) {
      return db.prepare('SELECT * FROM subscription_orders WHERE id = ?').get(id) || null;
    },
    async getSubscriptionOrderForUser(id, userId) {
      return db.prepare('SELECT * FROM subscription_orders WHERE id = ? AND user_id = ?').get(id, userId) || null;
    },
    async getSubscriptionOrderByPayload(payload) {
      return db.prepare('SELECT * FROM subscription_orders WHERE invoice_payload = ?').get(payload) || null;
    },
    async updateSubscriptionOrder(id, patch) {
      const keys = Object.keys(patch);
      if (!keys.length) return this.getSubscriptionOrder(id);
      db.prepare(`UPDATE subscription_orders SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => patch[k]), id);
      return this.getSubscriptionOrder(id);
    },
    async createSubscriptionPayment(row) {
      db.prepare(`INSERT INTO subscription_payments
        (id, order_id, provider, provider_payment_id, provider_event_id, status, amount, currency, charge_id, raw_event_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        row.id, row.order_id, row.provider, row.provider_payment_id, row.provider_event_id ?? null,
        row.status, row.amount, row.currency, row.charge_id ?? null, row.raw_event_json ?? null,
        row.created_at, row.updated_at
      );
      return this.getSubscriptionPayment(row.id);
    },
    async getSubscriptionPayment(id) {
      return db.prepare('SELECT * FROM subscription_payments WHERE id = ?').get(id) || null;
    },
    async findSubscriptionPayment(provider, providerPaymentId) {
      return db.prepare('SELECT * FROM subscription_payments WHERE provider = ? AND provider_payment_id = ?').get(provider, providerPaymentId) || null;
    },
    async getSubscriptionPaymentForUser(id, userId) {
      return db.prepare(`SELECT p.* FROM subscription_payments p
        JOIN subscription_orders o ON o.id = p.order_id
        WHERE p.id = ? AND o.user_id = ?`).get(id, userId) || null;
    },
    async listSubscriptionPaymentsForUser(userId, { chatId, limit = 100 } = {}) {
      if (chatId) return db.prepare(`SELECT p.*, o.chat_id, o.telegram_user_id, o.plan_name_snapshot
        FROM subscription_payments p JOIN subscription_orders o ON o.id = p.order_id
        WHERE o.user_id = ? AND o.chat_id = ? ORDER BY p.created_at DESC LIMIT ?`).all(userId, chatId, limit);
      return db.prepare(`SELECT p.*, o.chat_id, o.telegram_user_id, o.plan_name_snapshot
        FROM subscription_payments p JOIN subscription_orders o ON o.id = p.order_id
        WHERE o.user_id = ? ORDER BY p.created_at DESC LIMIT ?`).all(userId, limit);
    },
    async updateSubscriptionPayment(id, patch) {
      const keys = Object.keys(patch);
      if (!keys.length) return this.getSubscriptionPayment(id);
      db.prepare(`UPDATE subscription_payments SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => patch[k]), id);
      return this.getSubscriptionPayment(id);
    },
    async createSubscriptionEntitlement(row) {
      db.prepare(`INSERT INTO subscription_entitlements
        (id, order_id, chat_id, telegram_user_id, status, starts_at, expires_at, joined_at, removed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        row.id, row.order_id, row.chat_id, String(row.telegram_user_id), row.status ?? 'pending',
        row.starts_at ?? null, row.expires_at ?? null, row.joined_at ?? null, row.removed_at ?? null,
        row.created_at, row.updated_at
      );
      return this.getSubscriptionEntitlement(row.id);
    },
    async getSubscriptionEntitlement(id) {
      return db.prepare('SELECT * FROM subscription_entitlements WHERE id = ?').get(id) || null;
    },
    async createSubscriptionInviteLink(row) {
      db.prepare(`INSERT INTO subscription_invite_links
        (id, entitlement_id, telegram_chat_id, invite_link, status, expires_at, used_at, created_at, revoked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        row.id, row.entitlement_id, String(row.telegram_chat_id), row.invite_link, row.status ?? 'issued',
        row.expires_at ?? null, row.used_at ?? null, row.created_at, row.revoked_at ?? null
      );
      return db.prepare('SELECT * FROM subscription_invite_links WHERE id = ?').get(row.id) || null;
    },
    async getSubscriptionInviteLinkByUrl(inviteLink) {
      return db.prepare('SELECT * FROM subscription_invite_links WHERE invite_link = ?').get(inviteLink) || null;
    },
    async updateSubscriptionInviteLink(id, patch) {
      const keys = Object.keys(patch);
      if (!keys.length) return db.prepare('SELECT * FROM subscription_invite_links WHERE id = ?').get(id) || null;
      db.prepare(`UPDATE subscription_invite_links SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => patch[k]), id);
      return db.prepare('SELECT * FROM subscription_invite_links WHERE id = ?').get(id) || null;
    },
    async listSubscriptionInviteLinks(entitlementId) {
      return db.prepare('SELECT * FROM subscription_invite_links WHERE entitlement_id = ? ORDER BY created_at DESC').all(entitlementId);
    },
    async upsertSubscriptionJob(row) {
      db.prepare(`INSERT INTO subscription_jobs
        (id, job_type, entity_id, run_at, status, attempts, claimed_at, last_error, created_at)
        VALUES (?, ?, ?, ?, 'pending', 0, NULL, NULL, ?)
        ON CONFLICT(job_type, entity_id) DO UPDATE SET run_at = excluded.run_at, status = 'pending', last_error = NULL`).run(
        row.id, row.job_type, row.entity_id, row.run_at, row.created_at
      );
      return db.prepare('SELECT * FROM subscription_jobs WHERE job_type = ? AND entity_id = ?').get(row.job_type, row.entity_id) || null;
    },
    async claimDueSubscriptionJobs(now, limit = 25, workerId = 'sqlite-worker', leaseSeconds = 120) {
      const claimedAt = new Date().toISOString();
      const leaseUntil = new Date(Date.now() + leaseSeconds * 1000).toISOString();
      db.prepare(`UPDATE subscription_jobs SET status = 'running', attempts = attempts + 1,
        claimed_at = ?, claimed_by = ?, lease_until = ?
        WHERE id IN (SELECT id FROM subscription_jobs
          WHERE (status = 'pending' AND run_at <= ?)
             OR (status = 'running' AND lease_until IS NOT NULL AND lease_until <= ?)
          ORDER BY run_at LIMIT ?)`).run(claimedAt, workerId, leaseUntil, now, now, limit);
      return db.prepare("SELECT * FROM subscription_jobs WHERE status = 'running' AND claimed_by = ? AND claimed_at = ? ORDER BY run_at").all(workerId, claimedAt);
    },
    async completeSubscriptionJob(id, workerId = 'sqlite-worker') {
      db.prepare("UPDATE subscription_jobs SET status = 'completed', claimed_at = NULL, claimed_by = NULL, lease_until = NULL WHERE id = ? AND claimed_by = ?").run(id, workerId);
    },
    async failSubscriptionJob(id, error, retryAt, workerId = 'sqlite-worker') {
      db.prepare("UPDATE subscription_jobs SET status = 'pending', claimed_at = NULL, claimed_by = NULL, lease_until = NULL, last_error = ?, run_at = ? WHERE id = ? AND claimed_by = ?").run(String(error).slice(0, 1000), retryAt, id, workerId);
    },
    async addSubscriptionAuditLog(row) {
      db.prepare(`INSERT INTO subscription_audit_logs
        (user_id, chat_id, telegram_user_id, action, entity_type, entity_id, data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        row.user_id ?? null, row.chat_id ?? null, row.telegram_user_id ?? null, row.action,
        row.entity_type ?? null, row.entity_id ?? null, row.data ?? null, row.created_at
      );
    },
    async getSubscriptionEntitlementForUser(id, userId) {
      return db.prepare(`SELECT e.* FROM subscription_entitlements e
        JOIN subscription_orders o ON o.id = e.order_id
        WHERE e.id = ? AND o.user_id = ?`).get(id, userId) || null;
    },
    async getSubscriptionEntitlementByOrder(orderId) {
      return db.prepare('SELECT * FROM subscription_entitlements WHERE order_id = ?').get(orderId) || null;
    },
    async listSubscriptionEntitlements(chatId) {
      return db.prepare('SELECT * FROM subscription_entitlements WHERE chat_id = ? ORDER BY created_at DESC').all(chatId);
    },
    async listSubscriptionEntitlementsForTelegramUser(telegramUserId) {
      return db.prepare('SELECT * FROM subscription_entitlements WHERE telegram_user_id = ? ORDER BY expires_at IS NULL DESC, expires_at ASC').all(String(telegramUserId));
    },
    async updateSubscriptionEntitlement(id, patch) {
      const keys = Object.keys(patch);
      if (!keys.length) return this.getSubscriptionEntitlement(id);
      db.prepare(`UPDATE subscription_entitlements SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => patch[k]), id);
      return this.getSubscriptionEntitlement(id);
    },

    // ---- admin cross-tenant views ---------------------------------------
    async listAllBots() {
      return db.prepare(`SELECT b.*, u.email AS owner_email FROM bots b
        JOIN users u ON u.id = b.user_id ORDER BY b.created_at DESC`).all();
    },
    async listAllCredentials() {
      return db.prepare(`SELECT c.*, u.email AS owner_email FROM credentials c
        JOIN users u ON u.id = c.user_id ORDER BY c.created_at DESC`).all();
    },
    async listAllSubscriptionChats() {
      return db.prepare(`SELECT sc.*, u.email AS owner_email FROM subscription_chats sc
        JOIN users u ON u.id = sc.user_id ORDER BY sc.created_at DESC`).all();
    },

    // ---- subscription chat cascade delete --------------------------------
    async deleteSubscriptionChat(id) {
      const entitlements = db.prepare('SELECT id FROM subscription_entitlements WHERE chat_id = ?').all(id);
      for (const e of entitlements) {
        db.prepare('DELETE FROM subscription_invite_links WHERE entitlement_id = ?').run(e.id);
      }
      db.prepare('DELETE FROM subscription_entitlements WHERE chat_id = ?').run(id);
      const orders = db.prepare('SELECT id FROM subscription_orders WHERE chat_id = ?').all(id);
      for (const o of orders) {
        db.prepare('DELETE FROM subscription_payments WHERE order_id = ?').run(o.id);
      }
      db.prepare('DELETE FROM subscription_orders WHERE chat_id = ?').run(id);
      db.prepare('DELETE FROM subscription_plans WHERE chat_id = ?').run(id);
      db.prepare('DELETE FROM subscription_chats WHERE id = ?').run(id);
    },

    // ---- main (platform) subscription ------------------------------------
    async getMainSubscription() {
      return db.prepare("SELECT * FROM main_subscription WHERE id = 'main'").get() || null;
    },
    async upsertMainSubscription(row) {
      const existing = await this.getMainSubscription();
      const normalized = { ...row };
      if ('is_lifetime' in normalized) normalized.is_lifetime = normalized.is_lifetime ? 1 : 0;
      if ('enabled' in normalized) normalized.enabled = normalized.enabled ? 1 : 0;
      if (existing) {
        const keys = Object.keys(normalized).filter((k) => k !== 'id' && k !== 'created_at');
        db.prepare(`UPDATE main_subscription SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = 'main'`).run(...keys.map((k) => normalized[k]));
      } else {
        db.prepare(`INSERT INTO main_subscription
          (id, name, description, duration_value, duration_unit, is_lifetime, price_stars,
           price_fiat_amount, price_fiat_currency, crypto_currency, currency, enabled, created_at, updated_at)
          VALUES ('main', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          row.name, row.description ?? null, row.duration_value ?? null, row.duration_unit ?? null,
          normalized.is_lifetime ?? 0, row.price_stars ?? null, row.price_fiat_amount ?? null,
          row.price_fiat_currency ?? null, row.crypto_currency ?? null, row.currency ?? 'XTR',
          normalized.enabled ?? 0, row.created_at, row.updated_at
        );
      }
      return this.getMainSubscription();
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
