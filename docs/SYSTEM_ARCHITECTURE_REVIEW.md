# System Architecture & Code Review

**Date:** 2026-07-19
**Scope:** End-to-end system architecture: browser builder, Express API, Telegram ingress, runtime execution, persistence, deployment modes, and cross-cutting security/reliability.
**Related document:** [`CODE_REVIEW.md`](CODE_REVIEW.md) covers implementation-level and feature-contract findings.

## Current architecture

```text
React / React Flow builder
        │ REST + bearer JWT
        ▼
Express API ───────► SQLite (single host)
   │                 or Supabase/Postgres (serverless/shared)
   ├── bot manager ─► polling worker / in-memory chat locks
   ├── Telegram webhook receiver
   └── flow runtime ─► Telegram API, HTTP APIs, OpenAI-compatible APIs
```

The design is effective for a single persistent Node.js process and an early-stage product. It becomes unsafe or inconsistent when untrusted flow configuration, serverless execution, retries, or multiple application instances are introduced. The primary architectural need is to establish explicit **trust boundaries** and **durable execution semantics**.

## Architecture findings

### SA-01 — Critical: HTTP Request nodes create an SSRF boundary breach

**Evidence:** `server/src/runtime/actions.js` builds an Axios request directly from user-authored `d.url`; URLs and request bodies can be templated with user input.

Any flow owner can instruct the platform server to request arbitrary network locations, including private RFC1918 ranges, localhost services, cloud metadata endpoints, internal control planes, and services reachable only from the deployment network. Redirects can also turn an initially acceptable host into an internal destination. This is a serious concern on Railway, Render, Vercel, and any private/VPC deployment.

**Required design change:** Route HTTP-node traffic through an outbound-request policy layer. At minimum: allow only `https:` (and deliberate `http:` exceptions), resolve DNS and reject loopback/link-local/private/reserved IP ranges for every redirect hop, disable or validate redirects, block nonstandard ports, set response/body size caps, and add a host allowlist mode. For sensitive deployments, use a dedicated egress proxy with network policy. Treat templates from Telegram users as untrusted input.

---

### SA-02 — Critical: custom code execution shares the application trust boundary

**Evidence:** `server/src/runtime/actions.js` Function node uses `vm2` inside the API/runtime process.

A flow owner can run JavaScript in the same process that has database access and can decrypt bot tokens and credentials. `vm2` is not an adequate security boundary for a multi-tenant platform.

**Required design change:** Remove Function from the production execution plane until it is moved to a separately isolated service with no filesystem/network/credential access by default, strict CPU/memory/time quotas, and an allowlisted RPC API. See TL-01 in `CODE_REVIEW.md`.

---

### SA-03 — High: webhook handling is not durable on serverless platforms

**Evidence:** `server/src/routes/webhooks.js` calls `processUpdate(botId, req.body)` without awaiting it, then immediately returns HTTP 200. `api/index.js` runs this Express app as a Vercel function.

On serverless platforms, work after the response is not a durable execution mechanism; the invocation may be frozen or terminated. Telegram receives 200 even if the update never completes. This directly conflicts with the documented Vercel webhook deployment model.

**Required design change:** Acknowledge Telegram only after a durable enqueue, then process through a queue/worker (for example, managed queue plus a worker) with retries and a dead-letter policy. For a simpler short-term model, await bounded processing before 200, return a retryable status on failure, and document the platform time limit; this is still not a substitute for a queue.

---

### SA-04 — High: session ordering works only inside one Node.js process

**Evidence:** `server/src/hub/manager.js` uses the in-memory `chatLocks` `Map`; `server/src/db/supabase-repo.js` reads then upserts sessions without version checking.

The per-chat lock disappears across replicas, restarts, serverless invocations, and regions. Two updates for the same chat can read the same session, both send effects, and last-write-wins the session state. In a scaled webhook deployment this produces skipped states, duplicate messages, and corrupted variables.

**Required design change:** Use a distributed/durable ordering mechanism keyed by `botId:chatId` (queue partitioning, database advisory lock, or optimistic version column with compare-and-swap/retry). Define a single execution owner per conversation at a time. Do not rely on process-local locks as the concurrency model.

---

### SA-05 — High: Telegram update processing is not idempotent and side effects are not recoverable

**Evidence:** updates are processed then `persistSession` is called in `finally` in `server/src/runtime/engine.js`; no Telegram `update_id` is recorded; actions send Telegram/API effects before the session transition is durably committed.

Telegram and polling/webhook infrastructure can redeliver updates. A process failure after sending a message but before persistence makes replay likely. Conversely, persisting state before an external side effect can lose a message. Current behavior is at-least-once only accidentally and has no deduplication, outbox, or retry policy.

**Required design change:** Persist processed update IDs with a unique `(bot_id, update_id)` key, make session transitions versioned/transactional, and use an outbox/job table for outbound side effects. Workers should retry idempotently, with Telegram/API request identifiers where supported. Define expected delivery semantics in product documentation.

---

### SA-06 — High: polling deployment has no cross-instance ownership or leader election

**Evidence:** `server/src/hub/manager.js:initManager()` loads every `status = running` bot and starts it in each persistent process. Instance state is held only in the local `instances` map.

Running more than one server replica can start multiple pollers for the same Telegram token. At best Telegram returns polling conflicts; at worst updates and bot lifecycle state become unpredictable. Deploy/stop operations likewise do not coordinate across instances.

**Required design change:** Separate the API service from a worker service. Introduce a durable bot lease/leader election record, or run a single explicitly scaled worker replica for polling. Use a queue-based webhook worker for webhook mode as well. Report lease/worker health in the UI rather than local-process `isRunning` state.

---

### SA-07 — High: advanced-flow contracts are not matched by durable orchestration

**Evidence:** Parallel/Webhook execution limitations in `server/src/runtime/actions.js`; meta retry/timeout/disabled settings are not consumed by `runFrom`.

The runtime is an in-memory sequential interpreter plus one persisted current node. That model cannot correctly implement parallel branches, joins, durable delays, external webhook resumes, or per-node retries/timeouts without an explicit execution/job model.

**Required design change:** Define a workflow state model before expanding the node palette. Suggested minimum entities: `conversation`, `execution`, `execution_step`, `wait_subscription`, and `outbox_job`, all with status/version/timestamps. Model waits and delayed work as durable scheduled jobs instead of holding a request/process open. Hide unsupported features until their persistence model exists.

---

### SA-08 — Medium: flows have no schema version or migration path

**Evidence:** persisted `flow_draft`/`flow_published` JSON has nodes/edges/viewport but no `schemaVersion`; node semantics are read directly from ad hoc `data` fields.

Runtime and builder changes can silently alter existing bot behavior. The new named-node feature is backward-compatible only because it uses optional fields; future changes to handle IDs, defaults, or node contracts will be harder to deploy safely. Published flows cannot be audited against a known executor version.

**Required design change:** Add `schemaVersion` and a migration pipeline at load/publish time. Keep immutable published revisions with a revision ID and execution-time reference, rather than replacing one `flow_published` JSON blob. Provide migration previews and rollback.

---

### SA-09 — Medium: observability can store excessive user and upstream API data

**Evidence:** Log node defaults `includeVars: true` in `client/src/builder/nodeDefs.js`; `execLog` copies all runtime variables. HTTP result bodies and user input are session variables; `makeBotLogger` persists structured data.

Logs can retain user PII, chat content, API response bodies, and potentially secrets returned by upstream APIs. The current retention count is not a privacy policy, access boundary, or redaction strategy.

**Required design change:** Make full-variable logging opt-in with a strong warning, redact known sensitive keys recursively, cap structured payload size before serialization, establish time-based retention/deletion, and add audit controls. Separate operational logs from user-visible/debug logs.

---

### SA-10 — Medium: public API resilience controls are missing

**Evidence:** `server/src/index.js` enables unrestricted CORS and JSON parsing but has no request rate limits; auth routes perform synchronous bcrypt work; bot token validation and login endpoints have no abuse controls.

Bearer-token storage avoids browser-cookie CSRF by default, but public auth and token-validation routes remain susceptible to credential stuffing, account enumeration timing, and resource exhaustion. Unrestricted CORS is acceptable only if it is an intentional public API policy.

**Required design change:** Add edge/application rate limits by IP and account, request correlation IDs, payload/body caps per route, login backoff, and a production CORS allowlist configurable through environment. Move CPU-heavy hashing to async APIs or a worker pool as traffic grows.

## Target architecture recommendation

```text
Browser builder ──► API service ──► Flow revision store (Postgres)
                       │              │
                       │              ├── sessions/executions (versioned)
                       │              ├── update-deduplication table
                       │              └── outbox/jobs + scheduled waits
Telegram webhook ──► durable queue ──► workflow worker(s)
                                      │
                                      ├── per-conversation ordering
                                      ├── outbound Telegram/API adapters
                                      ├── egress policy / SSRF protection
                                      └── isolated code runner (only if retained)
```

### Delivery sequence

1. **Security gate:** mitigate SSRF (SA-01) and disable/isolate Function code (SA-02).
2. **Reliability foundation:** introduce durable update enqueueing, dedupe, conversation versioning, and a worker model (SA-03 through SA-06).
3. **Workflow product work:** implement or remove advanced nodes based on the durable state model (SA-07).
4. **Lifecycle and operations:** flow revisions/migrations, redacted observability, rate limiting, metrics, alerts, backup/restore drills (SA-08 through SA-10).

## Architectural strengths

- Clear initial separation between API routes, runtime execution, bot management, and persistence adapters.
- SQLite and Supabase repositories share an interface, which is a good foundation for testability and managed persistence.
- Flow draft vs. published separation protects live bots from unsaved builder edits.
- Per-chat serialization demonstrates the correct ordering intent; it needs promotion from local memory to a durable/distributed mechanism.
- Existing end-to-end self-test is a strong starting point for the API/runtime boundary.
