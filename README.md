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

## 🧭 Roadmap ideas

- Broadcast messages to stored sessions
- Media uploads (send photos/documents from the node)
- Webhook triggers **from** external services into a flow
- Flow templates & marketplace
- Multi-language bot responses
