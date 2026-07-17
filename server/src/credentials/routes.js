import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from '../auth/middleware.js';
import { ah, badRequest, notFound, zodError } from '../lib/http.js';
import {
  CREDENTIAL_TYPES,
  toPublicCredential,
  encryptCredentialData,
  mergeCredentialUpdate,
} from './service.js';

const createSchema = z.object({
  name: z.string().min(1, 'Name is required').max(80),
  type: z.enum(Object.keys(CREDENTIAL_TYPES)),
  data: z.record(z.any()).default({}),
});

export function credentialsRouter() {
  const r = Router();
  r.use(requireAuth);

  r.get('/types', ah(async (_req, res) => {
    res.json({ types: Object.entries(CREDENTIAL_TYPES).map(([id, t]) => ({ id, label: t.label, secretFields: t.secretFields })) });
  }));

  r.get('/', ah(async (req, res) => {
    const rows = await db.listCredentials(req.user.id);
    res.json({ credentials: rows.map(toPublicCredential) });
  }));

  r.post('/', ah(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(zodError(parsed.error));
    let data_enc;
    try {
      data_enc = encryptCredentialData(parsed.data.type, parsed.data.data);
    } catch (err) {
      throw badRequest(zodError(err));
    }
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      user_id: req.user.id,
      name: parsed.data.name.trim(),
      type: parsed.data.type,
      data_enc,
      created_at: now,
      updated_at: now,
    };
    await db.createCredential(row);
    res.status(201).json({ credential: toPublicCredential(row) });
  }));

  r.put('/:id', ah(async (req, res) => {
    const row = await db.getCredential(req.params.id);
    if (!row || row.user_id !== req.user.id) throw notFound('Credential not found');
    const parsed = z.object({
      name: z.string().min(1).max(80).optional(),
      data: z.record(z.any()).optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw badRequest(zodError(parsed.error));
    const patch = { updated_at: new Date().toISOString() };
    if (parsed.data.name) patch.name = parsed.data.name.trim();
    if (parsed.data.data) {
      try {
        patch.data_enc = mergeCredentialUpdate(row, parsed.data.data);
      } catch (err) {
        throw badRequest(zodError(err));
      }
    }
    const updated = await db.updateCredential(row.id, patch);
    res.json({ credential: toPublicCredential(updated) });
  }));

  r.delete('/:id', ah(async (req, res) => {
    const row = await db.getCredential(req.params.id);
    if (!row || row.user_id !== req.user.id) throw notFound('Credential not found');
    await db.deleteCredential(row.id);
    res.json({ ok: true });
  }));

  return r;
}
