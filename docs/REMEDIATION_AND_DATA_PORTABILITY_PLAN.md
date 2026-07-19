# Remediation, Backup/Restore, and Import/Export Plan

**Date:** 2026-07-19  
**Inputs reviewed:**

- [`CODE_REVIEW.md`](CODE_REVIEW.md)
- [`SYSTEM_ARCHITECTURE_REVIEW.md`](SYSTEM_ARCHITECTURE_REVIEW.md)
- [`QA_REVIEW.md`](QA_REVIEW.md)

## Objective

Turn Telebot Builder from a strong single-process prototype into a safe, testable, portable workflow platform. This plan addresses every review finding and adds user-facing flow export/import plus operational and user-level backup/restore.

## Product decisions to approve first

1. **Supported production scope until remediation:** basic sequential nodes only: Start, Message, Buttons, Input, Condition, Set Variable, HTTP (after egress controls), AI, Delay, End, and Log (after redaction). Hide/mark all other nodes as Experimental.
2. **Function/Code node:** disable in production immediately. Do not re-enable without isolated execution infrastructure and security sign-off.
3. **Durability target:** at-least-once inbound processing with idempotent update handling, durable outbound jobs, and per-conversation ordered execution.
4. **Portability tiers:**
   - **Flow export/import:** portable and safe; never includes bot tokens, credentials, sessions, logs, or user PII.
   - **Secure user backup/restore:** optional encrypted archive that can include selected bots and credentials.
   - **Operational database backup/restore:** administrator-operated, provider-native backup/PITR; not exposed as a normal user download.
5. **Compatibility contract:** every flow and archive has a schema version, migration history, validation report, and rollback path.

---

# Workstreams and phased plan

## Phase 0 — Immediate containment and truth in the UI

**Goal:** Remove unsafe and misleading behavior before new feature delivery.

### Deliverables

- Disable Function nodes in production with a migration-safe feature flag.
- Mark or hide Parallel and custom Webhook nodes, plus disabled/retry/node-timeout controls, until their runtime implementations exist.
- Update README and builder descriptions to show only supported node contracts.
- Fix README test-count drift and add a generated/CI-verified test summary.
- Publish a supported node/deployment matrix.

### Addresses

- TL-01, TL-03, TL-04
- QA-07, QA-08
- SQA-02, SQA-03
- SA-02, SA-07

### Acceptance criteria

- A user cannot publish a flow using a disabled production node without an explicit experimental opt-in.
- Every visible setting has a tested runtime effect.
- Product documentation accurately states supported node and deployment behavior.

---

## Phase 1 — Flow correctness, named values, and callback integrity

**Goal:** Make basic flows deterministic and make the builder only offer valid references.

### 1.1 Callback state machine hardening

Before processing callback data, require:

1. session status is `awaiting_callback`;
2. callback `nodeId` equals `session.node_id`;
3. the button exists in the current published flow;
4. the button is not a URL button; and
5. the requested source-handle edge exists or the documented fallback is valid.

Invalid/stale callbacks must be acknowledged to Telegram but leave the conversation state untouched and produce a safe log entry.

### 1.2 Named-value contract

Define one identifier rule used by UI, API validation, runtime, migration, and import:

```text
^[A-Za-z][A-Za-z0-9_-]*$
```

Apply it to node names, button value names, Input variable names, Set Variable names, and all `saveAs` fields. Normalize only on explicit user confirmation; otherwise show inline validation errors. Do not put an invalid reference into the picker.

### 1.3 Deterministic button namespace semantics

On each selection of a named Buttons node, replace that node's value namespace:

```json
{
  "plan": {
    "selected": "premium",
    "premium": "premium"
  }
}
```

Do not retain a previously selected `standard` property. Preserve normal global compatibility variables only where documented.

### 1.4 Path-aware picker

- Exclude URL buttons from value producers.
- Carry source-handle information during reverse graph traversal.
- Display only values guaranteed for the selected route.
- When a value is optional due to a condition/merge, label it **May be empty**.
- Improve the helper from copy-only to **Copy** and **Insert into selected field**. Keep keyboard-accessible alternatives.

### 1.5 Loop correction

Treat `0` explicitly as the documented unlimited setting, while enforcing a server-level hard cap and execution budget. Add validation explaining the cap.

### Addresses

- TL-02, TL-05, TL-06, TL-07, TL-08
- QA-01 through QA-06
- SQA-02

### Acceptance criteria

- Old, malformed, wrong-node, wrong-state, and duplicate callbacks cannot advance a session.
- A named reference offered by the picker is valid and can be produced on that route.
- Revisiting a Buttons node cannot leave previous choice properties present.
- Identifier behavior is consistent in browser validation, publish validation, runtime, import, and migration tests.
- Loop zero/limit behavior has unit and end-to-end coverage.

---

## Phase 2 — Export/import and backup/restore

**Goal:** Give users safe portability without leaking secrets or corrupting existing bots.

## 2.1 Flow export/import (default user feature)

### Export

Provide **Export flow** on the Builder and bot settings page. It downloads a JSON file with a clear MIME type and filename, for example:

```text
telebot-flow-<slug>-v1-2026-07-19.json
```

Proposed portable envelope:

```json
{
  "kind": "telebot-builder/flow-export",
  "schemaVersion": 1,
  "exportedAt": "2026-07-19T00:00:00.000Z",
  "appVersion": "...",
  "flow": { "nodes": [], "edges": [], "viewport": {} },
  "requirements": {
    "credentials": [
      { "logicalName": "openai-support", "type": "openai", "requiredBy": ["node-id"] }
    ]
  }
}
```

It must exclude bot token, credential secret values, sessions, logs, user identity, webhook secrets, and internal database IDs. Credential IDs inside imported flows must be converted to logical placeholders rather than copied as source-account IDs.

### Import

Provide **Import flow** with a preflight screen:

1. parse and size-limit the file;
2. verify `kind` and schema version;
3. migrate old supported versions in memory;
4. validate nodes, edges, identifiers, templates, and feature flags;
5. display a diff/summary: nodes, connections, warnings, unsupported nodes, required credentials;
6. map each required credential to an existing credential or create a placeholder;
7. offer **Replace draft** or **Create new draft**; never overwrite a published flow directly;
8. save only after explicit confirmation.

Imported flows must receive new flow revision metadata and must not reuse another account's bot IDs, credential IDs, webhook paths, or secrets.

## 2.2 Secure user backup/restore (optional privileged feature)

A normal flow export is intentionally secret-free. For users who need to move a complete workspace, provide an encrypted archive with explicit selection controls:

- bots and their draft/published flow revisions;
- non-secret bot settings;
- optionally bot tokens and credentials;
- optionally sessions/logs, clearly marked as PII and disabled by default.

### Archive format

Use a versioned manifest plus encrypted payload, e.g. `.tbbak`:

```text
manifest.json          # non-secret: kind, schemaVersion, KDF parameters, checksums
payload.enc            # AES-256-GCM encrypted bundle
```

- Require a user-chosen backup passphrase.
- Derive an archive key using a memory-hard KDF (Argon2id preferred; scrypt only with reviewed parameters if Argon2id is unavailable).
- Encrypt with a unique random salt, IV, and authenticated encryption tag.
- Decrypt only transiently during restore; never log the passphrase, plaintext, bot token, or credential content.
- Re-encrypt imported secrets using the destination platform key before persistence. Do not export raw platform-encrypted database blobs as the only portability mechanism, because those cannot be restored under a different platform key.

### Restore workflow

1. Upload with strict file-size/type limits.
2. Verify manifest, checksums, archive authentication tag, and schema support before creating data.
3. Show dry-run results: bots to create/update, credential conflicts, unsupported features, PII volume, and required remapping.
4. Require a collision strategy: create copies (default), merge selected drafts, or skip.
5. Create new IDs for bots, credentials, revisions, webhook secrets, and sessions.
6. Restore in a database transaction where supported; otherwise use a staged import record and compensating cleanup.
7. Restore bots in **stopped** state. Require an explicit post-restore deploy action to register a fresh webhook/poller.
8. Record a restore audit event with actor, time, archive version, and counts—never secret contents.

## 2.3 Operational backup and disaster recovery

This is separate from user export.

### SQLite

- Use SQLite's online backup API or a consistent `VACUUM INTO`/backup job, never a raw file copy while writing.
- Encrypt backups at rest, store off-host, define retention, and test restore into a clean environment.
- Back up persistent secrets/key material securely; losing the encryption key makes bot tokens and credentials unrecoverable.

### Supabase/Postgres

- Enable provider PITR and scheduled logical backups.
- Store backups in a separate account/bucket with encryption and access controls.
- Test point-in-time and full restore, including schema migrations and key availability.

### Required policies

- RPO/RTO targets, named owner, retention schedule, encryption/key-rotation plan, restore runbook, quarterly restore drill, and alerting on failed backups.

### Addresses

- SA-08 (schema versions/revisions/migrations)
- SA-09 (PII-aware export/logging)
- SQA-03 (backup/restore environment verification)
- User requirement: backup, restore, export, import

### Acceptance criteria

- A flow can be exported, imported into another account, credential-mapped, validated, and run without carrying source secrets or IDs.
- Corrupt, oversized, unauthenticated, unsupported, and malicious archives are rejected without partial data creation.
- A secure backup restores to a clean environment with new IDs and stopped bots.
- Restore does not register a webhook or start a poller without explicit user action.
- A documented restore drill proves the stated RPO/RTO.

---

## Phase 3 — Security boundaries and platform resilience

**Goal:** Make external integrations safe and harden the public platform.

### 3.1 HTTP egress/SSRF policy

Build a dedicated outbound-request layer for HTTP nodes:

- allow HTTPS by default;
- resolve DNS and block loopback, link-local, private, multicast, reserved, and cloud metadata IPs;
- re-check every redirect; disable redirects by default or validate each hop;
- apply host/port allowlists where tenants need them;
- cap request time, body size, redirects, and response size;
- separate outbound networking through an egress proxy for production.

### 3.2 Isolated code runner

Keep Function disabled until an isolated execution service is available: process/container isolation, no filesystem, no default network, no platform credentials, quota enforcement, audited capability RPC, and adversarial tests.

### 3.3 Data protection and public API controls

- Redact sensitive keys recursively before storing logs.
- Make full variable logging opt-in and default it off.
- Add retention by time and deletion controls for logs/sessions.
- Add rate limits/backoff to authentication and token validation.
- Configure an explicit production CORS allowlist.
- Add request IDs, security event logs, dependency/SAST scanning, and authorization-fuzz tests.

### Addresses

- SA-01, SA-02, SA-09, SA-10
- TL-01
- SQA-06

---

## Phase 4 — Durable execution architecture

**Goal:** Support webhook/serverless deployments, multiple workers, advanced nodes, and recovery correctly.

### Target components

```text
Telegram webhook / poller
          │
          ▼
 durable inbound-update store + queue (dedupe on bot_id, update_id)
          │
          ▼
 workflow worker(s), partitioned/locked by bot_id:chat_id
          │
          ├── versioned conversations + execution state
          ├── scheduled waits/delays
          ├── branch/join state for parallel work
          ├── external webhook subscriptions
          └── transactional outbox for Telegram/API effects
```

### Required data model additions

- `flow_revisions` — immutable published revision, schema version, migration metadata.
- `conversations` / `executions` — status, current work, version for optimistic concurrency.
- `processed_updates` — unique `(bot_id, update_id)` deduplication.
- `execution_steps` — audit/retry state per node attempt.
- `wait_subscriptions` — input, callback, external webhook, and timeout waits.
- `scheduled_jobs` — durable delay/retry/timeout work.
- `outbox_jobs` — idempotent Telegram/API actions.
- `backup_audit_events` — export/import/restore metadata.

### Behavioral requirements

- Queue/lock one conversation at a time across all worker instances.
- Persist state transitions before acknowledging inbound updates.
- Use idempotency keys and retry policies for outbound effects.
- Separate API serving from polling and workflow workers.
- Use bot leases/leader election so one poller owns a token.
- Make custom webhooks a registered, authenticated subscription with explicit route ownership.
- Implement Parallel only after branch persistence, join semantics, cancellation, and timeout behavior are specified and tested.
- Implement Disabled, retries, timeout, and durable delay centrally in the execution wrapper.

### Addresses

- SA-03 through SA-07
- TL-03, TL-04
- SQA-03, SQA-04

---

## Phase 5 — Quality engineering and release gates

**Goal:** Turn reviewed risks into permanent regression protection.

### Test layers

1. **Unit tests:** template identifiers, named-value semantics, validation, migration, SSRF policy, redaction, retry/backoff.
2. **Runtime integration tests:** stale/duplicate callbacks, input cancellation, crash/replay, update dedupe, loops, delays, retries, queue ordering.
3. **Repository contract tests:** identical SQLite and Supabase behavior.
4. **Browser tests (Playwright):** drag/drop, connections, dynamic handles, sidebar identity/reference picker, import/export preflight, save/publish/reload, keyboard flows.
5. **Security tests:** authorization matrix, SSRF fixtures, secret/log assertions, archive tampering, passphrase failure, dependency/SAST checks.
6. **Non-functional tests:** load, soak, fault injection, multi-worker race tests, backup restore drills, accessibility scans and manual keyboard/screen-reader checks.

### CI gates

- lint/format/type checks (introduce TypeScript incrementally or schema-derived runtime types);
- server tests, client build, browser smoke suite;
- dependency and secret scanning;
- minimum coverage targets for runtime/validation;
- migration/import fixture compatibility suite;
- release checklist requiring supported deployment matrix results.

### Addresses

- SQA-01 through SQA-06
- TL-09

---

# Prioritized roadmap

| Milestone | Scope | Release decision |
| --- | --- | --- |
| M0 | Feature flags, truthful UI/docs, Function disabled | Required immediately |
| M1 | Callback, named values, picker, loop correctness + regression tests | Required before named-reference promotion |
| M2 | Flow export/import v1 and operational backup runbook | Next user-facing capability |
| M3 | Secure encrypted workspace backup/restore | After threat model and key-management review |
| M4 | SSRF policy, log redaction, public API controls | Required before broad multi-tenant launch |
| M5 | Queue/workers, dedupe, execution persistence, revisions | Required before serverless/multi-instance claims |
| M6 | Parallel/custom Webhook/retries/timeouts/durable delays | Only after M5 |
| M7 | Full QA matrix, load, accessibility, restore drills | Release gate for production expansion |

## Governance and ownership

- **Tech lead:** supported-node contract, data model, execution architecture, rollout decisions.
- **Security owner:** HTTP egress policy, code-runner isolation, archive encryption/key management, security test approval.
- **Backend owner:** callback/state fixes, import services, queue/workers, repository contracts.
- **Frontend owner:** truthful feature flags, identifier UX, route-aware picker, import/export/restore UI and accessibility.
- **QA owner:** acceptance scenarios, browser automation, environment matrix, failure/load/restore drills.
- **Operations owner:** backup policy, keys, monitoring, worker health, RPO/RTO and incident runbooks.

## Definition of done

A workstream is complete only when its user contract is documented, its migrations are versioned, happy and negative paths are automated, observability is redacted, and the relevant deployment/recovery behavior has been tested—not merely when the UI control exists.
