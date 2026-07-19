import { Router } from 'express';
import { db } from '../db/index.js';
import { processUpdate } from '../hub/manager.js';

// Public webhook receiver. The per-bot secret in the path acts as the
// authentication mechanism (Telegram is the only caller that knows it).
export function webhooksRouter() {
  const r = Router();

  r.post('/telegram/:botId/:secret', async (req, res) => {
    const { botId, secret } = req.params;
    try {
      const bot = await db.getBot(botId);
      if (!bot || bot.webhook_secret !== secret || bot.status !== 'running' || bot.mode !== 'webhook') {
        return res.sendStatus(200); // always 200 so Telegram stops retrying
      }
      // Await handling so serverless runtimes do not freeze work after a 200
      // response. Durable queueing remains the long-term execution model.
      await processUpdate(botId, req.body);
    } catch (err) {
      console.error('[webhook] dispatch error:', err.message);
    }
    res.sendStatus(200);
  });

  return r;
}
