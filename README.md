# 🤖 Telebot Builder

**A visual, drag-and-drop Telegram bot builder platform.** Design conversation flows on a canvas, plug in your BotFather token, store action credentials in an encrypted vault, deploy with one click — no code required.

![stack](https://img.shields.io/badge/backend-Node.js%20%2B%20Express-339933) ![ui](https://img.shields.io/badge/frontend-React%20%2B%20React%20Flow-61dafb) ![db](https://img.shields.io/badge/db-SQLite%20%2F%20Supabase-3ecf8e)

---

## ✨ Features

| Area | What you get |
| --- | --- |
| 🎛 **Visual flow builder** | Drag & drop nodes (message, buttons, input, condition, HTTP, AI, delay…), wire them together, edit properties in an inspector panel. |
| 🔑 **BotFather token** | Paste your token, validated live against Telegram. Tokens are AES-256-GCM encrypted at rest. |
| 🔀 **Buttons & actions** | Inline keyboards where each button has its own output handle, plus URL buttons. |
| 💾 **Session management** | Per-chat state machine persisted to the DB: current node, variables, pending input — conversations survive restarts. Live session inspector with one-click reset. |
| 🌐 **HTTP action** | Call any API mid-flow with header/query/bearer/basic auth from stored credentials, save the JSON response into variables. |
| 🤖 **AI action** | OpenAI-powered replies (model, system prompt and variable capture configurable). |
| 👤 **Multi-user** | Email/password accounts with JWT auth; every user only sees their own bots and credentials. |
| 🚀 **Two deploy modes** | Long polling (zero-config) or webhooks (low latency) — per bot, switchable. Bots auto-resume after server restarts. |
| 📜 **Runtime logs** | Node-level execution tracing per bot with level filtering and auto-refresh. |
| 🗄 **SQLite by default** | Zero-setup embedded DB — or point at **Supabase** (Postgres) via env vars. |

## 🧱 Node types

| Node | Purpose |
| --- | --- |
| ▶️ **Start** | Entry point — runs on `/start` and new conversations. |
| 💬 **Message** | Send text (HTML + `{{variables}}`) or a photo with caption. |
| 🔘 **Buttons** | Question with inline keyboard. Each button = its own output handle; URL buttons supported. Waits for a tap. |
| ⌨️ **Collect Input** | Prompt the user, validate (number / email / regex) and store the answer in `{{your_variable}}`. `/cancel` escapes, and can be wired as its own handle. |
| 🔀 **Condition** | `{{variable}}` equals / contains / gt / regex… → **true** / **false** branches. |
| ⚙️ **Set Variable** | Compute values mid-flow with templates (`Order #{{id}}`, JSON parsing optional). |
| 🌐 **HTTP Request** | GET/POST/PUT/PATCH/DELETE with credentials + templated URL/headers/body. Stores `{status, body}` in a variable → `{{api.body.name}}`. |
| 🤖 **AI Reply** | OpenAI chat completions with system + templated user prompt; sends the reply and/or stores it. |
| ⏱️ **Delay** | Wait 1–600 seconds before continuing. |
| 🏁 **End** | Close the conversation with an optional goodbye. |

**Templating** works everywhere: `{{first_name}}`, `{{username}}`, `{{chat_id}}`, `{{text}}` (last user message) plus every variable you collect — dot paths for nested API responses (`{{api.body.data}}`).

## 🚀 Quick start

Requires **Node.js ≥ 22.5** (uses the built-in `node:sqlite`).

```bash
git clone <this repo> && cd telebot-builder
npm run install:all        # installs server + client deps

# terminal 1+2 — dev mode (Vite on :5173 proxying the API on :4000)
npm run dev

# …or production mode (server serves the built client on :4000)
npm run build
npm start
```

Open http://localhost:5173 (dev) or http://localhost:4000 (prod), create an account, then:

1. **Add a bot** — create one with [@BotFather](https://t.me/BotFather) (`/newbot`) and paste the token. The platform validates it via `getMe`.
2. **Build the flow** — drag nodes, wire handles, edit properties. Start with `Start → Message → Buttons`.
3. **Publish** — static validation catches broken flows (missing links, no variables…).
4. **Deploy** — choose *long polling* or *webhook*. Message your bot on Telegram. 🎉
5. **Watch** — *Sessions* shows live chat state & variables; *Logs* traces every node execution.

## ⚙️ Configuration

Copy `.env.example` → `.env`:

| Variable | Purpose |
| --- | --- |
| `PORT` | Server port (default `4000`). |
| `PUBLIC_BASE_URL` | Public HTTPS URL — **required for webhook mode** (e.g. ngrok during dev). |
| `JWT_SECRET` / `PLATFORM_SECRET` | Auth signing + vault encryption keys. Auto-generated into `.data/secrets.json` if omitted — set them explicitly in production. |
| `SESSION_TTL_HOURS` | Inactivity window before a conversation restarts (default `24`). |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | **Switch persistence from SQLite to Supabase Postgres.** Run [`server/db/supabase-schema.sql`](server/db/supabase-schema.sql) in your Supabase SQL editor first. |

### Webhook mode locally

```bash
ngrok http 4000
# .env → PUBLIC_BASE_URL=https://<your-subdomain>.ngrok.io
```

Deploys then register `https://…/webhooks/telegram/<botId>/<secret>` with Telegram automatically.

## ☁️ Deploy to Vercel

**Yes — with one architectural caveat.** Vercel serverless functions cannot keep long-running processes alive, and the filesystem is read-only. So on Vercel:

| Works | Doesn't work |
| --- | --- |
| ✅ Frontend (static SPA) | ❌ Long-polling bots (needs a persistent process — deploys are rejected with a clear error) |
| ✅ Full REST API as a serverless function | ❌ SQLite (read-only fs → **Supabase required**) |
| ⚠️ Webhook-mode bot execution is currently disabled pending a durable queue/worker | |
| ✅ Sessions, credentials, logs, multi-user auth | |

### Steps

1. **Push this repo to GitHub** and *Import Project* in Vercel. The included [`vercel.json`](vercel.json) already wires everything: client build, API serverless function ([`api/index.js`](api/index.js)), SPA fallback and a 60s function budget.
2. **Create a Supabase project** and run [`server/db/supabase-schema.sql`](server/db/supabase-schema.sql) in its SQL editor.
3. **Set environment variables** in Vercel → Project → Settings → Environment Variables:

| Variable | Value |
| --- | --- |
| `JWT_SECRET` | any long random string |
| `PLATFORM_SECRET` | any long random string (different one) |
| `SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase *service_role* key |
| `PUBLIC_BASE_URL` | `https://<your-app>.vercel.app` |

4. **Deploy** for the frontend and REST API. Bot execution on serverless is intentionally disabled until the durable queue/worker architecture is available; use the persistent Railway/Render deployment below for live bots. (If you forget Supabase, API calls return a precise "Database not configured…" message instead of an obscure crash.)

> ℹ️ `PUBLIC_BASE_URL` remains useful for API links, but serverless bot execution is disabled until durable worker support is implemented.

### Want polling bots too? Split hosting

Keep the **frontend on Vercel** and host the **backend on a persistent server** — ready-made configs are included (see below): [`railway.toml`](railway.toml) for Railway, [`render.yaml`](render.yaml) for Render (both polling and webhook modes work there, with SQLite or Supabase):

1. Deploy this repo to Railway/Render — full app served from one process (`npm start`). You can even just use THAT full deployment and skip Vercel entirely.
2. If you still prefer Vercel for the frontend: deploy with build env `VITE_API_URL=https://your-backend-host` — the client ([`src/api.js`](client/src/api.js)) then points all API calls there. Set `CORS_ORIGINS` on the backend to the Vercel frontend origin.

## 🚂 Deploy to Railway (polling ✅ + webhook ✅)

Railway keeps the process alive, so **both bot modes work**. The included [`railway.toml`](railway.toml) configures the build (`npm run install:all && npm run build`), start command, `/api/health` healthcheck and restart policy; Node 22 comes from `engines` in `package.json`.

1. **Railway → New Project → Deploy from GitHub repo.** That's the build/start done.
2. **Persist SQLite:** service → **Volumes → + New Volume**, mount path `/data`, then add env var `DATA_DIR=/data`. *(Skip this if you use Supabase instead — set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.)*
3. **Secrets (recommended):** add env vars `JWT_SECRET` and `PLATFORM_SECRET`. If omitted, random ones are generated into `.data/secrets.json` (persisted via the volume when step 2 is done — fine, but env vars are more robust).
4. **Public domain:** service → **Settings → Networking → Generate Domain**. Railway injects it as `RAILWAY_PUBLIC_DOMAIN`, which the server **auto-detects** as the webhook base URL — zero extra config for webhook deploys. Custom domains work the same way (set `PUBLIC_BASE_URL` to override).

> ⚠️ Without a volume, SQLite data lives on the ephemeral container filesystem and is wiped on every redeploy — you'll lose accounts/bots. Do step 2, or use Supabase.

## 🎨 Deploy to Render (polling ✅ + webhook ✅)

Render also keeps the process alive. The included [`render.yaml`](render.yaml) **Blueprint** provisions everything in one click:

1. **Render Dashboard → New → Blueprint** → select this repo.
2. Blueprint creates: a Node 22 web service (build `npm run install:all && npm run build`, start `npm start`, healthcheck `/api/health`), a **1 GB persistent disk** mounted at `/var/telebot/data` (wired via `DATA_DIR`), and auto-generated `JWT_SECRET` / `PLATFORM_SECRET` values.
3. **Public URL:** Render injects `RENDER_EXTERNAL_URL`, auto-detected by the server — webhook bots register against it with no manual setup.
4. The Blueprint defaults to the **starter** plan on purpose: the free tier has no persistent disks (SQLite wouldn't survive restarts) and sleeps when idle (which pauses polling bots). Prefer diskless + free? Go Supabase instead by uncommenting `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` in `render.yaml` and removing the disk.

## 🏗 Architecture

```
┌────────────┐   updates    ┌──────────────────────────────────────────┐
│  Telegram  │◄────────────►│  server (Express)                        │
└────────────┘  polling /   │  ├─ hub/manager  ─ live bot instances    │
               webhook      │  │    (TelegramClient + Poller)          │
                            │  ├─ runtime/engine ─ flow interpreter    │
┌────────────┐   REST API   │  │    · per-chat session state machine   │
│ React SPA  │◄────────────►│  │    · actions: buttons/input/cond/http │
│ React Flow │              │  ├─ credentials vault (AES-256-GCM)      │
└────────────┘              │  └─ auth (JWT) + REST API                │
                            ├──────────────────────────────────────────┤
                            │  SQLite (.data/telebot.db)   or   Supabase│
                            └──────────────────────────────────────────┘
```

```
server/
  src/
    auth/          JWT register/login/me + middleware
    bots/          bot CRUD, token validation, flow publish/validate, sessions, logs
    credentials/   encrypted action-credential vault (bearer/apikey/basic/openai)
    db/            repository interface → sqlite-repo (node:sqlite) | supabase-repo
    hub/           BotManager: deploy/stop/polling/webhook, per-chat update locks
    lib/           Telegram API client, templating, crypto, http helpers
    runtime/       flow engine + node executors
    routes/        public webhook receiver
  test/selftest.js 39-check end-to-end suite (API + engine, mock Telegram)
client/
  src/
    builder/       node definitions, custom React Flow node, properties panel
    pages/         Auth, Dashboard, Builder, Credentials, Sessions, Logs
```

## 🔒 Security notes

- Bot tokens & credential secrets are encrypted with **AES-256-GCM**; API responses only ever return masked previews (`••••••••1234`).
- Passwords hashed with **bcrypt**; auth via short-lived JWT bearer tokens.
- Webhook endpoints are authenticated by an unguessable per-bot secret path.
- Users can only ever access their own bots/credentials (ownership checked per query).

## 🧪 Testing

```bash
npm test        # 39 checks — crypto, REST API, auth isolation, full engine walk-through
```

The suite boots the real Express app against a temp SQLite DB and drives the flow engine with simulated Telegram updates (buttons, input validation, condition branches, HTTP node against a live local endpoint, session restarts).

## 📝 REST API (summary)

```
POST /api/auth/register|login        GET /api/auth/me
POST /api/bots/validate-token        CRUD /api/bots[/:id]
GET|PUT /api/bots/:id/flow           POST /api/bots/:id/flow/validate|publish
POST /api/bots/:id/deploy|stop
GET|DELETE /api/bots/:id/sessions[/:chatId]
GET|DELETE /api/bots/:id/logs
CRUD /api/credentials[/:id]          GET /api/credentials/types
POST /webhooks/telegram/:botId/:secret   (public, Telegram only)
```

## 💳 Subscription management

The paid-access subscription module is documented in [`docs/SUBSCRIPTIONS.md`](docs/SUBSCRIPTIONS.md). It supports Telegram Stars plans, NOWPayments crypto checkout, one-use invite links, membership activation, reminders, expiry removal, refunds, and creator-side subscriber management. Creator payouts are intentionally not included in the MVP.

## 🧭 Roadmap ideas

- Broadcast messages to stored sessions
- Media uploads (send photos/documents from the node)
- Webhook triggers **from** external services into a flow
- Flow templates & marketplace
- Multi-language bot responses

## 📚 Detailed flow documentation

See [`docs/FLOW_BUILDER.md`](docs/FLOW_BUILDER.md) for the complete flow lifecycle, JSON format, output-handle IDs, button callback continuation, session persistence, validation rules, node-extension checklist, testing commands, and pin-alignment troubleshooting.
