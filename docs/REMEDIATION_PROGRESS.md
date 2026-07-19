# Remediation Progress

**Updated:** 2026-07-19  
**Reference plan:** [`REMEDIATION_AND_DATA_PORTABILITY_PLAN.md`](REMEDIATION_AND_DATA_PORTABILITY_PLAN.md)

## Current estimate

These are engineering estimates, not gate approvals.

| Area | Completion | Current state |
|---|---:|---|
| Immediate safety containment | 85% | Function code execution removed; unsupported advanced nodes hidden/gated; serverless bot execution disabled pending durable workers. |
| Flow correctness / named values / callbacks | 80% | Callback validation, value freshness, identifier checks, branch-aware picker, malformed-flow validation, and loop limit fixes are in place. |
| Flow export/import | 70% | Versioned, secret-free flow export/import and credential mapping are implemented. Import preview/mapping UI remains. |
| Backup/restore | 25% | Safe flow backup and operational runbook exist. Encrypted full-workspace backup/restore and restore drills remain. |
| HTTP egress, logging, CORS, rate limits | 65% | HTTP egress restrictions, redaction, CORS policy, and local rate limits are implemented. Edge/distributed enforcement and further security testing remain. |
| Durable execution / queues / multi-instance safety | 20% | Update claiming and awaited webhook execution are implemented. Queue, outbox, worker leasing, distributed locking, and durable delayed work remain. |
| Browser QA / accessibility / load / fault testing | 10% | Server self-test coverage has expanded. Browser automation, accessibility scans, load/fault testing, and deployment-matrix coverage remain. |
| Final SSE / QA / Tech Lead approval | 0% passed | Final reviews occur only after the remaining blockers are resolved. |

## Overall

- **Plan implementation:** approximately **50%** complete.
- **Final review-gate readiness:** approximately **30%**.

## Completed increments

- Callback hardening and named-value persistence fixes
- Safe button namespace replacement and route-aware value picker
- Identifier and malformed-flow validation improvements
- Experimental node containment and removal of in-process `vm2` execution
- Configurable bounded step limits and failed-session handling with `/retry`
- HTTP egress restrictions and redirect/proxy/body-size controls
- Recursive secret-shaped log redaction and opt-in full-variable logging
- Production CORS policy and abuse limits for auth/token validation
- Inbound update claim/de-duplication and webhook awaiting
- Portable flow export/import with secret exclusion and credential mapping
- Flow backup/restore operational documentation

## Remaining gate blockers

1. Durable queue/outbox and crash-safe side-effect processing.
2. Distributed conversation ordering and worker ownership for multi-instance deployments.
3. Encrypted full-workspace backup/restore with key management and restore drills.
4. Immutable flow revisions/schema migrations and import preview UX.
5. Browser automation, accessibility, load/fault, and deployment-matrix tests.
6. Fresh SSE, QA/Senior QA, and Tech Lead reviews with no blocking findings.
