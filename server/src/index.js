import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db } from './db/index.js';
import { authRouter } from './auth/routes.js';
import { botsRouter } from './bots/routes.js';
import { credentialsRouter } from './credentials/routes.js';
import { subscriptionsRouter } from './subscriptions/routes.js';
import { adminRouter } from './admin/routes.js';
import { nowPaymentsWebhookRouter } from './subscriptions/nowpayments-webhook.js';
import { webhooksRouter } from './routes/webhooks.js';
import { initManager, shutdownManager } from './hub/manager.js';
import { initSubscriptionBot, shutdownSubscriptionBot } from './subscriptions/system-bot.js';
import { HttpError } from './lib/http.js';

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({
    origin(origin, callback) {
      const allowed = config.env !== 'production' || !origin || config.corsOrigins.includes(origin);
      callback(null, allowed);
    },
  }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      db: db.provider,
      time: new Date().toISOString(),
      capabilities: {
        experimentalParallel: config.allowExperimentalParallelNodes,
        experimentalWebhook: config.allowExperimentalWebhookNodes,
        experimentalFunction: false,
      },
    });
  });
  app.use('/api/auth', authRouter());
  app.use('/api/bots', botsRouter());
  app.use('/api/credentials', credentialsRouter());
  app.use('/api/subscriptions', subscriptionsRouter());
  app.use('/api/admin', adminRouter());
  app.use('/webhooks', webhooksRouter());
  app.use('/webhooks', nowPaymentsWebhookRouter());

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint' }));

  // Serve the built client (production) with SPA fallback.
  if (fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/webhooks')) return next();
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }

  // Central error handler: HttpError → proper status, everything else → 500.
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      return res.status(400).json({ error: 'Invalid request body.' });
    }
    console.error('[api] unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const app = buildApp();
  const server = app.listen(config.port, async () => {
    console.log(`[server] telebot-builder listening on http://localhost:${config.port}`);
    console.log(`[server] ${fs.existsSync(config.clientDist) ? 'Serving built client.' : 'Client not built — run "npm run dev:client" or "npm run build".'}`);
    if (config.useSupabase) console.log('[server] Supabase persistence enabled.');
    await initManager();
    try {
      await initSubscriptionBot();
    } catch (error) {
      console.error('[subscription-bot] failed to start:', error.message);
    }
    if (config.publicBaseUrl) {
      console.log(`[server] Webhook base URL: ${config.publicBaseUrl}`);
    } else {
      console.log('[server] No public base URL detected — webhook mode unavailable, polling works fine.');
    }
  });

  const shutdown = () => {
    console.log('\n[server] shutting down…');
    shutdownManager();
    shutdownSubscriptionBot();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
