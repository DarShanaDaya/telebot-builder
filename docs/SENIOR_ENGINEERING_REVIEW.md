# Senior Software Engineer Code Review

**Date:** 2026-07-19  
**Scope:** Post-remediation branch through `47b62d1`, with focus on implementation correctness, maintainability, failure behavior, and the path from a single-process prototype to a dependable product.  
**Relationship to prior reviews:** This is an independent engineering review. It confirms that the latest callback/named-value fixes are directionally correct, but it does **not** certify the broader remediation program as complete.

## What was rechecked

- Flow persistence and validation
- Runtime state machine, callback/input waits, node execution, and error handling
- SQLite/Supabase repository abstraction
- Builder data model and name/reference picker
- Bot manager/webhook lifecycle
- Existing self-test design and build status

## Positive changes verified

- Callback execution now checks the session is awaiting the same Buttons node before routing.
- Non-link callback buttons are explicitly required.
- Re-entering a named Buttons node replaces its previous namespace, avoiding stale choice values.
- Output identifiers are validated for Input, Set Variable, HTTP, AI, Function, and Webhook output fields.
- The picker no longer treats URL buttons or invalid identifiers as value producers.
- Loop zero semantics no longer accidentally map to 100 through `0 || 100`.

The server self-test reports **44/44 passing** and the client production build passes. Those checks are helpful but do not cover the findings below.

## Findings

### SSE-01 — High: valid published flows can be terminated after only 40 synchronous nodes

**Evidence:** `server/src/runtime/engine.js` hard-codes `MAX_STEPS = 40`; `server/src/config.js` allows `maxFlowNodes: 500`; `server/src/bots/validate.js` does not calculate/flag executable path length.

A simple linear flow with 41 Message/Set Variable/Condition nodes can pass publication validation, then the runtime logs an error and ends the conversation. This is an unexpected product limit and is especially inconsistent with the 500-node authoring limit.

**Recommendation:** Make the execution budget a documented configuration value, distinguish a per-update budget from total workflow progress, and validate/warn on paths that can exceed it. The durable execution architecture should yield/requeue work rather than end the session. Add a 41+ node regression test.

---

### SSE-02 — High: Function node remains executable despite the containment plan

**Evidence:** `server/src/runtime/actions.js` still imports `vm2`, registers `function: execFunction`, and executes user-authored code in the application process. The user interface and palette still expose this node.

The remediation plan requires Function to be disabled in production, but this has not happened. The new output-name validation improves correctness, not the code-execution trust boundary.

**Recommendation:** Implement the Phase 0 feature flag now: hide Function from the normal palette, reject publication/execution unless an explicit non-production experimental flag is enabled, and ensure existing published Function flows report a clear, safe failure rather than executing.

---

### SSE-03 — High: runtime error handling can silently strand conversations

**Evidence:** `server/src/runtime/engine.js:runFrom()` catches executor errors, logs them, and assigns `session.status = 'idle'` without a durable error state, retry record, error branch, or user response.

For example, a Telegram send failure, HTTP library failure outside its local handling, malformed AI response, or credential/service error can leave the user with no message. Their next message restarts the flow because idle behavior starts from Start. This turns a transient service failure into an invisible reset.

**Recommendation:** Add a `failed`/`paused` execution status with node ID, sanitized failure code, attempt count, and operator-visible recovery action. When retries are implemented, centralize them in the executor wrapper. Until then, send a configured safe fallback to the user and preserve enough state to diagnose/resume intentionally.

---

### SSE-04 — Medium: invalid callbacks still mutate persisted variables

**Evidence:** `server/src/runtime/engine.js:handleCallback()` assigns `vars.last_callback = data` before stale-node and button validation.

The routing fix correctly leaves the wait state intact, but an invalid or stale callback is still persisted in session variables. This violates the intended “leave state untouched” behavior and makes templates/logs report a callback that was rejected.

**Recommendation:** Move `vars.last_callback = data` after all callback validation passes. Add an assertion that a rejected callback leaves variables unchanged.

---

### SSE-05 — Medium: malformed flow JSON can still trigger a server error during validation

**Evidence:** `server/src/bots/validate.js:91-98` assumes a named button value has a string `.trim()` method after the initial optional access. Similar code patterns use optional string methods for user-provided JSON fields.

The API accepts arbitrary flow JSON for drafts. A crafted flow where `button.name` is an object/number can cause validation to throw rather than return a structured validation error. This is not cross-account access, but it makes import/API behavior brittle and prevents reliable preflight diagnostics.

**Recommendation:** Validate a flow through a schema before semantic validation. Treat every node field as untrusted JSON; use `typeof value === 'string'` guards consistently. The import pipeline should reuse the same schema and return field-level errors.

---

### SSE-06 — Medium: the persistence abstraction is asynchronous in shape but SQLite blocks the event loop

**Evidence:** `server/src/db/sqlite-repo.js` uses synchronous `DatabaseSync` calls inside `async` methods.

The API/runtime appears asynchronous, but every SQLite operation, including log retention deletes, executes synchronously on the single Node.js event loop. Under several active chats, slow disk or a large log table can delay all Telegram webhook handling and API requests.

**Recommendation:** Keep SQLite explicitly single-node/small-scale and set documented capacity limits, or move persistence to an asynchronous driver/service for production. Batch log retention, avoid pruning on every log write, and add load tests to establish a safe operating envelope.

---

### SSE-07 — Medium: flow state and user side effects are coupled too tightly for reliable recovery

**Evidence:** node executors send Telegram/API effects inline; `persistSession` occurs only after `handleUpdate` completes.

A process crash or timeout between `sendMessage` and session persistence allows a redelivery/restart to repeat the effect; reversing order would risk skipping it. This is the implementation-level manifestation of the architecture review's outbox/idempotency finding.

**Recommendation:** Do not add more side-effecting nodes until execution transitions and outbound effects are separated through a durable outbox. Add idempotency keys/update dedupe as the minimum interim protection.

---

### SSE-08 — Medium: client and server capability contracts are duplicated and will drift

**Evidence:** node types, output fields, handle IDs, validation rules, picker output rules, and executor registrations are defined in separate files across `client/src/builder/nodeDefs.js`, `TbNode.jsx`, `PropertiesPanel.jsx`, `Builder.jsx`, `server/src/bots/validate.js`, and `server/src/runtime/actions.js`.

The current named-value work already required synchronized edits in multiple locations. This increases the risk that a future node is rendered in the builder but not executable, or an executor output is unavailable in the picker.

**Recommendation:** Define a shared versioned node contract/schema package (or generated JSON schema) containing type IDs, output definitions, identifier fields, feature status, and validation metadata. Have the client, server validation, import/export, and documentation consume it. Add a contract test ensuring every palette node has an executor and validation behavior.

---

### SSE-09 — Low: no static type/lint gate protects the complex dynamic data model

**Evidence:** JavaScript files contain optional dynamic flow data throughout; package scripts contain build/test but no lint, format, typecheck, or coverage commands.

The code uses a rich user-authored JSON model and several cross-layer contracts. Build-only checks will not catch many property-name/type mismatches.

**Recommendation:** Introduce ESLint and formatting immediately, then incrementally add TypeScript or Zod-derived types for flow/node data and repository interfaces. Add CI checks for lint, test, build, schema fixtures, and coverage thresholds.

## Recommendation for the current remediation program

The latest commit is a good Phase 1 partial increment. Before moving into broad export/import UI work, complete these engineering gates:

1. **Immediately:** SSE-02 and SSE-04.
2. **Before enabling larger flows:** SSE-01 and SSE-03.
3. **Before import/backup workflows:** SSE-05 and SSE-08, so imported JSON has one reliable schema contract.
4. **Before scaling deployment claims:** SSE-06 and SSE-07, alongside the queue/outbox architecture work in `SYSTEM_ARCHITECTURE_REVIEW.md`.

## Review status

**Result: changes are not yet approved as fully resolved.** The callback/named-value patch is approved as an incremental improvement, subject to the remaining findings and the three-reviewer closure process.
