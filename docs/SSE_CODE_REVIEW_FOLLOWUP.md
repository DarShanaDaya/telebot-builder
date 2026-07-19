# Senior Software Engineer Follow-up Code Review

**Date:** 2026-07-19  
**Scope:** Review of the latest remediation increment, commit `0ec5b66` (`Gate experimental nodes and preserve failures`).  
**Result:** **Changes not approved as final.** The increment improves the safety posture, but introduces/retains correctness gaps that must be addressed before the reviewer gate can close.

## Positive observations

- Experimental Function, Parallel, and custom Webhook nodes are removed from the normal palette and are rejected by publish validation unless explicitly enabled.
- Runtime error paths now persist a `failed` status rather than silently converting failure into an idle restart.
- Invalid callback payloads no longer set `last_callback` before validation.
- The execution-step limit is configurable and aligned more closely with the configured maximum node count.
- The latest server self-test and client build passed in the preceding implementation increment.

## Findings

### SSE-F01 — High: a callback referencing a missing node still resets the active session

**Evidence:** `server/src/runtime/engine.js:279-284`.

The new stale-callback checks occur only after finding the callback node. If an old Telegram keyboard refers to a node removed by a published flow update, this branch executes first:

```js
session.status = 'idle';
session.pending = null;
return;
```

This clears an active input/button wait, exactly the state-integrity behavior the callback hardening was intended to prevent.

**Required fix:** Treat a missing callback node exactly like every other invalid/stale callback: log it, acknowledge it, and leave `status`, `node_id`, `pending`, and variables unchanged. Add a regression test using a callback node ID absent from the current flow while the session awaits Input.

---

### SSE-F02 — High: an invalid `MAX_FLOW_STEPS_PER_UPDATE` environment value can disable the loop guard

**Evidence:** `server/src/config.js:83`.

```js
Math.max(1, Number(process.env.MAX_FLOW_STEPS_PER_UPDATE || 500))
```

For `MAX_FLOW_STEPS_PER_UPDATE=abc`, `Number(...)` is `NaN`; `Math.max(1, NaN)` is also `NaN`. Every comparison of `++steps > MAX_STEPS` is then false, removing the infinite-loop protection. `Infinity` similarly removes the practical cap.

**Required fix:** Parse and clamp only finite integers, e.g. default to 500 when absent/invalid and cap a reasonable maximum. Add configuration tests for `0`, negative, decimal, `NaN`, and `Infinity` inputs.

---

### SSE-F03 — High: unknown node types are still publishable and silently skipped at runtime

**Evidence:** `server/src/bots/validate.js` emits a warning for the default/unknown-node case; `server/src/runtime/engine.js:140-144` logs `Unknown node type ... — skipped.` and follows the default edge.

A malformed/imported flow or a flow authored against a newer node version can publish with warnings, then silently omit business logic in production. This is particularly dangerous for import/export and schema migration work.

**Required fix:** Make unsupported node types publish-blocking errors by default. Only permit explicit, versioned compatibility transforms. At runtime, mark the execution failed rather than skipping an unknown node. Add import/validation tests for unknown node types.

---

### SSE-F04 — Medium: production code execution is only hidden/gated, not removed from the trust boundary

**Evidence:** `server/src/runtime/actions.js` still imports `vm2`, registers `execFunction`, and enables it with `ALLOW_EXPERIMENTAL_NODES=true`.

The default is safer, but a single environment flag re-enables an acknowledged unsafe server-process code runner. This is risky because a deployment operator may enable experimental nodes to test Parallel/Webhook behavior and inadvertently enable Function at the same time.

**Required fix:** Use separate capability flags per experimental family. Keep Function permanently disabled in production builds until an isolated runner exists; do not couple it to generic experimental-node opt-in. Ideally remove `vm2` from the production dependency graph now.

---

### SSE-F05 — Medium: failed-session metadata may persist sensitive upstream error text

**Evidence:** `server/src/runtime/engine.js:155-160` stores `String(err.message).slice(0, 500)` in `session.pending`.

HTTP/Axios/API errors can include URLs, query strings, response fragments, or provider diagnostic text. The Sessions API exposes parsed pending state to the bot owner. Error details should be useful but not become an unredacted storage channel.

**Required fix:** Persist a stable error code/node ID/timestamp and a sanitized user-safe message. Keep full diagnostics in protected server logs only after recursive redaction. Add tests containing a URL query secret and assert it is not stored in the session or returned from the Sessions API.

---

### SSE-F06 — Medium: failed state has no operator recovery or lifecycle policy

**Evidence:** `server/src/runtime/engine.js:261-262` only tells users to send `/start`; the sessions API provides reset only by deleting an entire session.

This is better than a silent restart, but not enough for operations. Failed conversations can accumulate indefinitely, have no retry/resume mechanism, and do not surface a structured cause in the UI. A user loses context when forced to restart.

**Required fix:** Add a versioned failure payload, admin/UI actions for retry from the failed node, restart, and clear; define TTL/retention behavior. Implement these as part of the durable execution model rather than adding ad hoc state transitions.

---

### SSE-F07 — Low: experimental capability state is not visible or documented for operators

**Evidence:** `ALLOW_EXPERIMENTAL_NODES` is only read in server configuration; it is not included in `.env.example`, health/admin capability output, builder messaging, or deployment documentation.

A flow can be import-valid in one environment and rejected in another without a visible explanation of the capability policy.

**Required fix:** Add feature capability metadata to a protected configuration/status endpoint, display it in the builder, document all flags, and include capability checks in import preflight.

## Required reviewer-gate actions

1. Fix SSE-F01 through SSE-F03 before approving the current runtime hardening.
2. Split Function execution policy from generic experimental-node policy (SSE-F04).
3. Design sanitized error persistence and an explicit failed-execution lifecycle (SSE-F05, SSE-F06).
4. Add configuration/capability visibility and corresponding tests (SSE-F07).

This follow-up review does **not** close the senior engineering reviewer gate.
