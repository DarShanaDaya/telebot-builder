import crypto from 'node:crypto';
import { config } from '../config.js';

// AES-256-GCM vault used to store BotFather tokens and user action credentials.
// The key is derived from the platform secret; every payload carries its own IV.
const KEY = crypto.scryptSync(config.platformSecret, 'telebot-builder/vault/v1', 32);
const PREFIX = 'v1';

export function encryptString(plain) {
  if (plain == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${PREFIX}.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

export function decryptString(payload) {
  if (!payload) return null;
  const [v, ivB64, tagB64, dataB64] = String(payload).split('.');
  if (v !== PREFIX || !ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

export function encryptJson(obj) {
  return encryptString(JSON.stringify(obj ?? {}));
}

export function decryptJson(payload) {
  const s = decryptString(payload);
  return s ? JSON.parse(s) : {};
}

// Show only the last 4 chars of each secret field when returning to clients.
export function maskSecrets(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v == null || v === '') out[k] = '';
    else if (typeof v === 'string' && v.length <= 8) out[k] = '••••••••';
    else if (typeof v === 'string') out[k] = `••••••••${v.slice(-4)}`;
    else out[k] = v;
  }
  return out;
}
