# Technical Code Review

**Date:** 2026-07-19  
**Scope:** Current working branch, including the named-node value/reference work (`baa73fd`, `8582fab`) and the runtime features it depends on.  
**Method:** Static review of the React builder, flow validation, runtime engine/actions, webhook/manager routes, and the current end-to-end self-test. Client build and server self-test were previously run successfully; passing checks do not cover the findings below.

## Executive summary

The application has a clear separation between the builder, persisted flow, runtime, and database repositories. The new triple-brace named-value feature is directionally sound: references are namespaced, node names are checked at publish time, and values persist with the session.

The main release risk is **feature-contract correctness**. Several controls advertised in the builder either do not run, or only partially run, in the runtime. Before treating the advanced palette as production-ready, the team should either implement those contracts or hide/label them as experimental. The Function node also requires a security redesign before use in a multi-tenant deployment.

## Findings

### TL-01 — Critical: `vm2` is not an acceptable isolation boundary for tenant-supplied code

**Evidence:** `server/src/runtime/actions.js`, `createSandbox` and `execFunction`; `server/package.json` depends on `vm2`.

The Function node executes flow-owner supplied JavaScript in the server process. `vm2` has a history of sandbox escapes and is not a sufficient security boundary for untrusted, multi-tenant code. A successful escape would expose the process, database access, bot tokens, and credentials.

**Recommendation:** Disable Function nodes in production until code execution is moved to a separately sandboxed execution service/worker with OS/container isolation, strict resource limits, no credentials, no network by default, and an allowlisted RPC surface. If custom code is a core product feature, define its threat model and add adversarial security testing before release.

---

### TL-02 — High: callback data is trusted without confirming the active wait

**Evidence:** `server/src/runtime/engine.js:248-285`.

`handleCallback` looks up the node embedded in callback data and follows its edge without confirming that the session is currently `awaiting_callback`, that `session.node_id` is the same node, or that the configured button still exists and is non-link. A stale Telegram keyboard (for example after publish), or a callback from a prior state, can clear the current wait and route the session from a different node. An unknown button ID falls back to the node's default output.

**Recommendation:** Accept a callback only when all of the following are true:

1. `session.status === 'awaiting_callback'`;
2. `session.node_id === nodeId`;
3. the button exists and has no URL; and
4. its named source edge is valid for the published flow.

Reject invalid/stale callbacks without changing session state. Add tests for old keyboards, unknown button IDs, and callbacks received while waiting for Input.

---

### TL-03 — High: the Parallel and custom Webhook nodes are presented as working features but do not execute their contract

**Evidence:** `server/src/runtime/actions.js:365-412`, `server/src/routes/webhooks.js`.

`execParallel` explicitly logs that branches “would start,” then only returns the first branch's next node. It does not run the other branches, wait for them, merge output, or enforce its advertised timeout semantics. The custom Webhook node says it creates a public endpoint, but the only registered public route is Telegram's `/webhooks/telegram/:botId/:secret`; no route resolves a Webhook node's configured path or provides `ctx.webhookData`.

**Recommendation:** Either:

- remove these nodes from the production palette and mark existing flows as unsupported/experimental; or
- implement a durable orchestration model (branch state, join rules, per-branch persistence, cancellation/timeout) and an explicit webhook route registry/authentication design.

Do not market or document these as available until end-to-end tests demonstrate their behavior.

---

### TL-04 — High: advanced settings are persisted and advertised but ignored by the executor

**Evidence:** `client/src/builder/PropertiesPanel.jsx` (`Disabled`, retry, and timeout controls); `server/src/runtime/engine.js` `runFrom`.

The UI saves `data.meta.disabled`, `data.meta.retry`, and `data.meta.timeoutMs`, but `runFrom` never reads these fields. Users can configure a node as disabled or add retries and timeouts, publish successfully, and observe no effect. This is an operational reliability issue because it gives a false recovery/control surface.

**Recommendation:** Implement a central node execution wrapper that honors skip, per-node timeout, bounded retry/backoff, and structured error logging. Until then, remove these UI controls or label them “not yet executed” and block publish when configured.

---

### TL-05 — High: named Buttons values retain stale choices when the node is revisited

**Evidence:** `server/src/runtime/engine.js:54-60`, called from `server/src/runtime/engine.js:281`.

`recordNodeValue` merges a value into the named node namespace. If a user first selects `standard` and later revisits the same `plan` Buttons node and selects `premium`, the session contains both `plan.standard` and `plan.premium`. `{{{plan.standard}}}` can then resolve to a prior selection instead of being empty.

**Recommendation:** For a Buttons selection, replace that node's namespace with the current choice (or explicitly record a single `selected` property plus the selected value name). Define restart and loop semantics, and test two different selections in the same session.

---

### TL-06 — Medium: the previous-values picker offers link-button values that can never be set

**Evidence:** `client/src/pages/Builder.jsx:54-64`; `server/src/runtime/actions.js` `execButtons`.

The picker includes every button with a `name`, including URL buttons. URL buttons do not issue Telegram callbacks, so their named value is never written by `handleCallback`. The sidebar can therefore copy a reference that always resolves to an empty string.

**Recommendation:** Exclude URL buttons from produced values, or visually identify them as navigation-only and prevent value-name configuration.

---

### TL-07 — Medium: the picker overstates values guaranteed on a branch

**Evidence:** `client/src/pages/Builder.jsx:161-180`.

The reverse graph traversal finds all ancestors, then displays every output from each ancestor. For a Buttons node, a selected node connected solely to the `standard` handle still sees tokens for `premium` and `cancel`. Those values are not guaranteed to exist on the selected route.

**Recommendation:** Carry source-handle/path information during the reverse traversal and filter branch outputs accordingly, or clearly label those tokens as “may be empty.”

---

### TL-08 — Medium: Loop's documented `0 = unlimited` setting is implemented as 100

**Evidence:** `client/src/builder/PropertiesPanel.jsx` describes `0 = unlimited`; `server/src/runtime/actions.js` computes `Math.max(0, Number(d.iterations) || 100)`.

Because `0 || 100` evaluates to `100`, a user setting zero gets a 100-iteration cap, contradicting the editor help text.

**Recommendation:** Preserve zero explicitly, e.g. distinguish an absent/non-numeric value from `0`. Also retain a platform-level hard safety cap so “unlimited” cannot create unbounded work.

---

### TL-09 — Medium: test coverage does not protect the advertised advanced/runtime contracts

**Evidence:** `server/test/selftest.js` covers a linear buttons/input/condition/HTTP flow; no client test suite is configured.

There are no focused tests for callback validity, stale keyboards, named-value reset semantics, loops, parallel branches, external webhooks, disabled nodes, retries, timeouts, flow migration, or picker path filtering. The current single self-test is valuable smoke coverage but cannot safely validate the feature set exposed by the palette.

**Recommendation:** Split tests into focused engine, validation, route, and builder suites. Add a browser-level test tool (for example Playwright) for node identity, picker insertion/copying, and publish validation. Gate release on the documented supported node matrix.

## Strengths

- The flow runtime uses persistent per-chat sessions and serializes updates per chat.
- Credential encryption and ownership isolation are present and exercised by the existing self-test.
- The builder stores a stable flow representation separate from React Flow presentation state.
- Named-node references are intentionally namespaced and node-name uniqueness is validated.
- Runtime logs provide an appropriate starting point for operational debugging.

## Recommended delivery plan

1. **Immediately:** address TL-01 and TL-02; hide unsupported advanced nodes/settings.
2. **Next:** define a supported flow-runtime contract, fix named-value freshness, link-button picker behavior, and loop semantics.
3. **Then:** implement advanced nodes only with persistence/concurrency design and end-to-end tests.
4. **Before broader release:** add CI with server tests, client build, dependency/security scanning, and browser coverage for the builder.
