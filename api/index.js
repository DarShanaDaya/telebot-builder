// Vercel serverless entrypoint.
//
// The full Express app (REST API + Telegram webhook receiver) runs as a single
// serverless function. Important: serverless functions cannot keep long-running
// processes alive, so on Vercel:
//   • bots must use WEBHOOK mode (long polling is rejected with a clear error)
//   • persistence must be Supabase (SQLite is unavailable on read-only fs)
//   • JWT_SECRET and PLATFORM_SECRET must be set as environment variables
import { buildApp } from '../server/src/index.js';

const app = buildApp();

export default function handler(req, res) {
  app(req, res);
}
