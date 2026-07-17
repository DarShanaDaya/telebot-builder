import { config } from '../config.js';

// Repository selection: Supabase when credentials are provided, otherwise the
// built-in SQLite database stored in .data/telebot.db.
let repo;
if (config.useSupabase) {
  const { createSupabaseRepo } = await import('./supabase-repo.js');
  repo = createSupabaseRepo(config.supabase);
  console.log('[db] Using Supabase Postgres at', config.supabase.url);
} else {
  const { createSqliteRepo } = await import('./sqlite-repo.js');
  repo = createSqliteRepo();
  console.log('[db] Using SQLite database in .data/telebot.db');
}

export const db = repo;
