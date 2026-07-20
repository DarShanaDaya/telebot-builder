import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');
const isServerlessHost = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, '.data');
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {
  // Read-only filesystem (serverless) — SQLite mode will be unavailable,
  // the db layer surfaces a precise error if Supabase is not configured.
}

// Load (or generate + persist) server-side secrets. Generated secrets are kept
// in .data/secrets.json so the platform works out-of-the-box while remaining
// stable across restarts. Set JWT_SECRET / PLATFORM_SECRET in production.
function loadSecrets() {
  const file = path.join(DATA_DIR, 'secrets.json');
  let persisted = {};
  if (fs.existsSync(file)) {
    try {
      persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      persisted = {};
    }
  }
  const secrets = {
    jwtSecret: process.env.JWT_SECRET || persisted.jwtSecret || crypto.randomBytes(32).toString('hex'),
    platformSecret: process.env.PLATFORM_SECRET || persisted.platformSecret || crypto.randomBytes(32).toString('hex'),
  };
  if (!process.env.JWT_SECRET || !process.env.PLATFORM_SECRET) {
    try {
      fs.writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
      if (isServerlessHost) {
        console.warn('[config] WARNING: JWT_SECRET/PLATFORM_SECRET are not set — generated secrets do NOT persist on serverless. Set them as environment variables.');
      }
    } catch {
      console.error('[config] Could not persist generated secrets (read-only fs). Set JWT_SECRET and PLATFORM_SECRET as environment variables.');
    }
  }
  return secrets;
}

const secrets = loadSecrets();

export function boundedPositiveInteger(value, fallback, { min = 1, max = 10000 } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

// Webhook registration needs the platform public base URL. Set PUBLIC_BASE_URL
// explicitly, or let hosting platforms that inject their public domain
// (Railway, Render) fill it in automatically.
const publicBaseUrl = (
  process.env.PUBLIC_BASE_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
  process.env.RENDER_EXTERNAL_URL ||
  ''
).replace(/\/+$/, '');

export const config = {
  env: process.env.NODE_ENV || 'development',
  isServerless: isServerlessHost,
  isVercel: Boolean(process.env.VERCEL),
  port: Number(process.env.PORT || 4000),
  publicBaseUrl,
  subscriptionBotToken: process.env.SUBSCRIPTION_BOT_TOKEN || '',
  subscriptionBotUsername: process.env.SUBSCRIPTION_BOT_USERNAME || '',
  nowPaymentsApiKey: process.env.NOWPAYMENTS_API_KEY || '',
  nowPaymentsIpnSecret: process.env.NOWPAYMENTS_IPN_SECRET || '',
  nowPaymentsIpnUrl: process.env.NOWPAYMENTS_IPN_URL || '',
  // Production API access is same-origin unless explicit frontend origins are
  // configured. Development remains permissive for the Vite dev server.
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
  jwtSecret: secrets.jwtSecret,
  jwtExpiresIn: '7d',
  platformSecret: secrets.platformSecret,
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 24),
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
  get useSupabase() {
    return Boolean(this.supabase.url && this.supabase.serviceKey);
  },
  clientDist: path.join(ROOT_DIR, 'client', 'dist'),
  // Safety limits
  maxFlowNodes: 500,
  // A per-update safety ceiling. Waiting nodes yield execution, so this does
  // not limit total conversation length; it prevents accidental synchronous
  // cycles from monopolizing a worker.
  maxFlowStepsPerUpdate: boundedPositiveInteger(process.env.MAX_FLOW_STEPS_PER_UPDATE, 500, { min: 1, max: 5000 }),
  maxHttpTimeoutMs: 30000,
  // Private-network egress is never allowed in production. Local integration
  // tests may opt in explicitly before the config module loads.
  allowPrivateHttpTargets: process.env.NODE_ENV !== 'production' && process.env.ALLOW_PRIVATE_HTTP_TARGETS === 'true',
  allowInsecureHttpTargets: process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_HTTP_TARGETS === 'true',
  maxDelaySeconds: 600,
  logRetentionPerBot: 500,
  // Incomplete nodes are individually opt-in only outside production. Function
  // code remains hard-disabled until an isolated runner exists.
  allowExperimentalFunctionNodes: false,
  allowExperimentalParallelNodes: process.env.NODE_ENV !== 'production' && process.env.ALLOW_EXPERIMENTAL_PARALLEL_NODES === 'true',
  allowExperimentalWebhookNodes: process.env.NODE_ENV !== 'production' && process.env.ALLOW_EXPERIMENTAL_WEBHOOK_NODES === 'true',
};
