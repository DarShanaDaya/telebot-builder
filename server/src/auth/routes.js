import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from '../db/index.js';
import { signToken, requireAuth } from './middleware.js';
import { ah, badRequest, conflict, unauthorized, zodError } from '../lib/http.js';
import { rateLimit } from '../lib/rate-limit.js';

const registerSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1).max(80).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, created_at: u.created_at });

export function authRouter() {
  const r = Router();
  const authRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

  r.post('/register', authRateLimit, ah(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(zodError(parsed.error));
    const email = parsed.data.email.toLowerCase().trim();
    if (await db.findUserByEmail(email)) throw conflict('An account with this email already exists.');
    const user = {
      id: crypto.randomUUID(),
      email,
      name: parsed.data.name?.trim() || email.split('@')[0],
      password_hash: bcrypt.hashSync(parsed.data.password, 10),
      created_at: new Date().toISOString(),
    };
    await db.createUser(user);
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  }));

  r.post('/login', authRateLimit, ah(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(zodError(parsed.error));
    const user = await db.findUserByEmail(parsed.data.email.toLowerCase().trim());
    if (!user || !bcrypt.compareSync(parsed.data.password, user.password_hash)) {
      throw unauthorized('Invalid email or password.');
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  }));

  r.get('/me', requireAuth, ah(async (req, res) => {
    res.json({ user: req.user });
  }));

  return r;
}
