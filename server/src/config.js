import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, '.data');
fs.mkdirSync(DATA_DIR, { recursive: true });

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
    fs.writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  }
  return secrets;
}

const secrets = loadSecrets();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
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
  maxHttpTimeoutMs: 30000,
  maxDelaySeconds: 600,
  logRetentionPerBot: 500,
};
