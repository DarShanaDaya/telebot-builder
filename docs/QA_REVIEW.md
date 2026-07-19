# QA & Senior QA Review

**Date:** 2026-07-19  
**Review mode:** Two parallel review streams:

- **QA review:** functional behavior, validation, regression scenarios, and user-visible flow-builder behavior.
- **Senior QA review:** release readiness, automation quality, negative-path coverage, environments, non-functional risk, and quality gates.

**Scope:** Current branch through commit `f0aa7d4`.

## Automated execution results

| Check | Result |
| --- | --- |
| `npm test` in `server/` | Pass — **41/41** self-test checks |
| `npm run build` in `client/` | Pass — Vite production build completed |
| `npm audit --omit=dev --json` in `server/` | Pass — 0 production dependency vulnerabilities reported |
| `npm audit --omit=dev --json` in `client/` | Pass — 0 production dependency vulnerabilities reported |
| UI/browser automation | Not configured / not executed |
| Supabase, Vercel/serverless, live Telegram validation | Not automated / not executed |

> Passing smoke checks are positive, but they do not cover the release-blocking functional and system risks listed below.

---

# QA Review — Functional findings

## QA-01 — High: namespaced references silently fail for several supported value names

**Evidence:** `client/src/pages/Builder.jsx:59-63` exposes Input `variable`, Set Variable `name`, and HTTP/AI/Function/Webhook `saveAs` values in the picker. `server/src/runtime/engine.js:52-60` writes a namespaced value only if `isReferenceName(valueName)` matches `^[A-Za-z][\w-]*$`. The client only replaces spaces in several relevant editors; it does not enforce that full rule. `server/src/bots/validate.js` validates node names and button names, but not these output value names.

**Reproduction:**

1. Create an Input node named `contact`.
2. Set **Save answer to variable** to `email.address`.
3. Connect it to a Message node and select `{{{contact.email.address}}}` from the previous-values picker.
4. Publish and run the flow.

The global variable is written as `vars['email.address']`, but no namespaced node value is recorded because the runtime rejects the value name. The triple-brace reference resolves to an empty string. Similar failures occur with invalid Set Variable/HTTP/AI/Function/Webhook output names.

**Expected:** The editor must either normalize these names consistently, or validation must block publication with an actionable message. The picker must only offer references that the runtime can produce.

---

## QA-02 — High: stale/unknown button callbacks can progress the wrong flow state

**Evidence:** `server/src/runtime/engine.js:248-285` does not verify the pending session node/status or confirm that `button` exists before clearing state and taking an edge.

**User impact:** Tapping an old inline keyboard after flow publish can skip an active input/button wait or route through a default output. This is observable bot behavior, not only a security concern.

**Required regression cases:**

- callback from a keyboard sent before a publish that removes/changes the button;
- callback while session is awaiting Input;
- callback from a different Buttons node in the same flow;
- unknown button ID; and
- double-tap/repeated callback.

---

## QA-03 — High: named Buttons references retain values from previous selections

**Evidence:** `server/src/runtime/engine.js:54-60` merges values in `_nodeValues[nodeName]`; button selection records only the selected property at line 281.

**Reproduction:**

1. In a Buttons node called `plan`, select `standard`.
2. Re-enter the same node in the same session, then select `premium`.
3. Render both `{{{plan.standard}}}` and `{{{plan.premium}}}`.

Both may resolve even though the latest state should only represent `premium`.

**Expected:** A Buttons node should have deterministic documented semantics. Normally its namespace should be replaced on each selection, with an optional explicit `selected` field if needed.

---

## QA-04 — Medium: URL buttons are incorrectly presented as runtime value producers

**Evidence:** `client/src/pages/Builder.jsx:58` lists every named button in the picker. `execButtons` generates URL buttons without callback data, so `handleCallback` never records their value.

**User impact:** The UI offers a copyable `{{{node.link_button}}}` token that will always be blank after a user opens a URL.

**Expected:** Exclude URL buttons from named values or label them as navigation-only.

---

## QA-05 — Medium: picker may offer values that cannot exist on the selected branch

**Evidence:** `client/src/pages/Builder.jsx:161-180` follows all graph ancestors and returns all outputs for each ancestor, without preserving branch-handle information.

**User impact:** A downstream node on a `standard` button branch can select `{{{plan.cancel}}}`. That reference is not set on its path and renders blank.

**Expected:** Filter branch outputs by the path/handle leading to the selected node, or label non-guaranteed values as optional/may be empty.

---

## QA-06 — Medium: Loop editor and runtime disagree about zero iterations

**Evidence:** The Loop inspector says `0 = unlimited`; `server/src/runtime/actions.js` uses `Math.max(0, Number(d.iterations) || 100)`. JavaScript converts zero through `||` to `100`.

**Expected:** Preserve zero deliberately and apply a separately documented platform safety ceiling.

---

## QA-07 — Medium: builder exposes controls whose runtime behavior is absent

**Evidence:** node advanced settings expose Disabled, Retry Attempts, Retry Delay, and Timeout in `PropertiesPanel.jsx`; `runFrom` does not consume these settings. Parallel and custom Webhook nodes are similarly incomplete.

**User impact:** A user can configure, save, validate, and publish settings that do nothing.

**Expected:** Remove/hide unsupported controls, mark them experimental, or add complete runtime behavior and end-to-end tests.

---

## QA-08 — Low: user-facing test-count documentation is stale

**Evidence:** `README.md` says the self-test has 39 checks; current execution reports 41.

**Expected:** Derive test reporting where possible or update the README when test coverage changes.

---

# Senior QA Review — Release readiness and quality system

## SQA-01 — Blocker: no browser/UI automation for the primary product surface

The visual builder is the main product, but the repository has no browser test framework, component test framework, or UI test files. Build success verifies syntax/bundling only; it does not verify drag/drop, dynamic handles, sidebar editing, copy helpers, keyboard behavior, publish error display, or flow persistence.

**Required gate:** Add Playwright (or equivalent) smoke coverage for:

- authentication and bot creation;
- add/select/edit/connect/delete nodes;
- dynamic button/case/branch handles;
- named-node reference picker and copied token behavior;
- save draft, validate warnings/errors, publish, and reload persistence;
- responsive sidebar and core keyboard interactions.

---

## SQA-02 — Blocker for advanced-node release: test suite covers one linear happy-path flow only

`server/test/selftest.js` is a useful integrated smoke suite, but it primarily exercises Start → Message → Buttons → Input → Condition → HTTP → Set Variable → Message → End. It does not protect advanced node behavior or key negative paths.

**Missing engine coverage:**

- stale/malformed/repeated callbacks and input cancellation paths;
- named-value invalid names, clearing/revisiting selections, and branch availability;
- loops, zero iterations, max iterations, and loop persistence;
- Parallel behavior and joins;
- Function errors/isolation boundaries;
- custom webhook entry/resume behavior;
- retries, disabled nodes, node timeout, delay interruption;
- malformed flow JSON, missing node targets, duplicate source handles, and migration fixtures.

**Required gate:** Split the self-test into focused deterministic suites and require relevant coverage before enabling each node type in the palette.

---

## SQA-03 — Blocker for supported deployment claims: no environment compatibility matrix is tested

The application documents SQLite, Supabase, persistent polling, webhook mode, Vercel/serverless, Railway, and Render. Automated tests only run against temporary SQLite in one local Node process.

**Missing matrix:**

- Supabase repository contract tests against an isolated test database;
- webhook processing under serverless time/response behavior;
- restart recovery for polling and webhook bots;
- multiple worker/replica concurrency for one chat;
- deployment smoke checks for production configuration and required secrets;
- backup/restore and data-retention tests.

**Required gate:** Define the supported deployment matrix and test each target in CI or scheduled integration environments. Do not claim parity until the repository implementations pass identical contract tests.

---

## SQA-04 — High: no delivery, performance, or resilience test strategy exists

There are no load tests, soak tests, fault-injection tests, or performance budgets. Current process-local locking, synchronous SQLite calls, synchronous bcrypt, in-request delays, and outbound requests make scale behavior unpredictable.

**Required tests:**

- burst messages/callbacks for a single chat and many chats;
- Telegram redelivery and duplicate update tests;
- database/API timeouts, partial failures, process restarts, and worker crashes;
- response-size, slowloris/body-size, and HTTP-node egress limits;
- latency/SLO thresholds for API endpoints and flow continuation.

---

## SQA-05 — High: accessibility and usability checks are absent

The builder relies heavily on canvas interactions and icon-only controls. There are no automated accessibility scans or keyboard-navigation scenarios. The button editor relies on placeholders for several inputs, which is not a durable accessible-name strategy.

**Required gate:** Add automated axe checks and manual keyboard/screen-reader acceptance criteria. Ensure all controls have explicit labels/ARIA names, visible focus states, and non-drag alternatives for connecting/managing nodes.

---

## SQA-06 — Medium: security/dependency checks are positive but incomplete as quality gates

Production dependency audits currently report zero vulnerabilities for client and server. That is good, but it does not test application-level SSRF, tenant isolation, code-sandbox escape, secret redaction, JWT lifecycle, or authorization fuzzing.

**Required gate:** Add SAST/dependency scanning to CI, API authorization matrix tests, SSRF test fixtures, secret-in-log assertions, and periodic penetration testing before external multi-tenant launch.

---

## Release verdict

| Release scope | QA verdict |
| --- | --- |
| Current basic linear demo flow in one local process | **Conditional pass** after fixing QA-01 through QA-03 or clearly documenting the limitations |
| Named-node references and picker as a broadly reliable feature | **No-go** until stale state, invalid-name validation, and picker truthfulness are fixed and tested |
| Advanced palette nodes/settings | **No-go** until implementation and automated acceptance coverage exist |
| Multi-instance, serverless, or multi-tenant production launch | **No-go** pending the system-architecture blockers in `SYSTEM_ARCHITECTURE_REVIEW.md` |

## Recommended QA delivery plan

1. Add regression tests for QA-01 to QA-07 and fix the high-severity functional defects.
2. Establish unit/engine, API contract, and Playwright UI suites with CI execution.
3. Publish an explicit supported-node and supported-deployment matrix.
4. Add performance, failure, accessibility, and security quality gates before production expansion.
