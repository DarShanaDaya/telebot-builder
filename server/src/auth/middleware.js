import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { unauthorized } from '../lib/http.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw unauthorized();
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw unauthorized('Session expired. Please sign in again.');
    }
    const user = await db.findUserById(payload.sub);
    if (!user) throw unauthorized('Account not found.');
    req.user = { id: user.id, email: user.email, name: user.name, created_at: user.created_at };
    next();
  } catch (err) {
    next(err);
  }
}
