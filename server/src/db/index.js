import { config } from '../config.js';
import { HttpError } from '../lib/http.js';

const sqliteUnavailable = () => {
  throw new HttpError(
    500,
    'Database not configured: this deployment runs on a serverless host (read-only filesystem), ' +
    'so the built-in SQLite database is unavailable. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
    'environment variables (schema: server/db/supabase-schema.sql) and redeploy.'
  );
};

// Repository selection: Supabase when credentials are provided, otherwise the
// built-in SQLite database stored in .data/telebot.db. On serverless hosts
// (Vercel, AWS Lambda) SQLite cannot work — every method surfaces a precise,
// actionable error instead of an obscure fs failure.
let repo;
if (config.useSupabase) {
  const { createSupabaseRepo } = await import('./supabase-repo.js');
  repo = createSupabaseRepo(config.supabase);
  console.log('[db] Using Supabase Postgres at', config.supabase.url);
} else if (config.isServerless) {
  repo = new Proxy(
    { provider: 'unconfigured' },
    {
      get: (target, prop) =>
        prop === 'provider' ? target.provider : sqliteUnavailable,
    }
  );
  console.error('[db] Serverless host detected without Supabase — API calls that touch the database will return a configuration error.');
} else {
  const { createSqliteRepo } = await import('./sqlite-repo.js');
  repo = createSqliteRepo();
  console.log('[db] Using SQLite database in .data/telebot.db');
}

export const db = repo;
