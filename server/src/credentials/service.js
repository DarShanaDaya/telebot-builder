import { z } from 'zod';
import { db } from '../db/index.js';
import { encryptJson, decryptJson, maskSecrets } from '../lib/crypto.js';

// Credential types and the secret fields they store. HTTP Request and AI nodes
// reference these by id; values never leave the server unencrypted at rest and
// are masked in every API response.
export const CREDENTIAL_TYPES = {
  bearer: {
    label: 'Bearer token',
    schema: z.object({ token: z.string().min(1, 'Token is required') }),
    secretFields: ['token'],
  },
  apikey: {
    label: 'API key',
    schema: z.object({
      key: z.string().min(1, 'API key is required'),
      headerName: z.string().optional().default(''),
      queryParam: z.string().optional().default(''),
    }),
    secretFields: ['key'],
  },
  basic: {
    label: 'Basic auth',
    schema: z.object({
      username: z.string().min(1, 'Username is required'),
      password: z.string().min(1, 'Password is required'),
    }),
    secretFields: ['password'],
  },
  openai: {
    label: 'OpenAI',
    schema: z.object({
      apiKey: z.string().min(1, 'API key is required'),
      model: z.string().optional().default('gpt-4o-mini'),
      baseUrl: z.string().optional().default(''),
    }),
    secretFields: ['apiKey'],
  },
};

export function validateCredentialData(type, data) {
  const def = CREDENTIAL_TYPES[type];
  if (!def) throw new Error(`Unknown credential type "${type}"`);
  return def.schema.parse(data || {});
}

export const toPublicCredential = (row) => ({
  id: row.id,
  name: row.name,
  type: row.type,
  masked: maskSecrets(decryptJson(row.data_enc)),
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export function encryptCredentialData(type, data) {
  return encryptJson(validateCredentialData(type, data));
}

// Merge an update with existing values: blank secret fields keep the old value.
export function mergeCredentialUpdate(row, patch) {
  const current = decryptJson(row.data_enc);
  const merged = { ...current };
  for (const [k, v] of Object.entries(patch || {})) {
    if (typeof v === 'string' && v.trim() === '') continue;
    merged[k] = v;
  }
  return encryptCredentialData(row.type, merged);
}

// Used by the runtime engine: resolves a credential that belongs to the bot's
// owner and returns its decrypted data.
export async function resolveCredential(userId, credentialId) {
  if (!credentialId) return null;
  const row = await db.getCredential(credentialId);
  if (!row || row.user_id !== userId) return null;
  return { id: row.id, name: row.name, type: row.type, data: decryptJson(row.data_enc) };
}
