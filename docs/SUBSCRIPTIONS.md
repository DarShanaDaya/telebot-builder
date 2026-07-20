# Subscription management

The subscription module manages paid access to Telegram channels, groups, and supergroups. It is separate from visual bot flows and uses a protected platform-owned subscription bot.

## Current flow

```text
Creator links Telegram account
  -> Adds the subscription bot as chat administrator
  -> Creates a plan
  -> Customer uses /buy PLAN_ID or /buycrypto PLAN_ID
  -> Payment is verified
  -> Entitlement is created
  -> One-use join-request invite is sent
  -> Membership event activates access
  -> Reminders and expiry jobs run
```

## Required environment

```env
SUBSCRIPTION_BOT_TOKEN=123456:bot-token
SUBSCRIPTION_BOT_USERNAME=membership_bot
```

The subscription bot must be hosted on a persistent deployment. Add it to each managed chat and grant only the permissions required by the selected access policy:

- Invite users
- Restrict members, when automatic expiry removal is enabled

For NOWPayments crypto checkout:

```env
NOWPAYMENTS_API_KEY=...
NOWPAYMENTS_IPN_SECRET=...
NOWPAYMENTS_IPN_URL=https://your-host.example/webhooks/nowpayments
```

Run the updated Supabase schema after adding the module. SQLite creates additive tables and columns during startup. The backend accepts `SUPABASE_SECRET_KEY` (preferred) or the legacy `SUPABASE_SERVICE_ROLE_KEY`; this key is server-only and must never be placed in client-side environment variables. The publishable key is not used for server-side repository access.

## Creator API

All endpoints require the existing Bearer authentication.

```text
POST /api/subscriptions/connections
GET  /api/subscriptions/chats
POST /api/subscriptions/chats
GET  /api/subscriptions/chats/:chatId

POST   /api/subscriptions/chats/:chatId/plans
GET    /api/subscriptions/chats/:chatId/plans
PATCH  /api/subscriptions/plans/:id
DELETE /api/subscriptions/plans/:id

GET  /api/subscriptions/chats/:chatId/entitlements
POST /api/subscriptions/chats/:chatId/grant
POST /api/subscriptions/entitlements/:id/revoke

GET  /api/subscriptions/payments
GET  /api/subscriptions/payments/:id
POST /api/subscriptions/payments/:id/refresh
POST /api/subscriptions/payments/:id/refund
```

`DELETE` for a plan deactivates it; it does not delete historical orders. Payment and entitlement records are tenant-scoped.

## Customer bot commands

```text
/start
/connect CODE
/buy PLAN_ID
/buycrypto PLAN_ID
/status
/my_subscription
/paysupport
```

Telegram Stars orders are fulfilled only after `successful_payment`. Pre-checkout approval is not treated as proof of payment.

NOWPayments orders are fulfilled only after a signed IPN reports `finished`, or after an authenticated creator refreshes the payment status.

## Payment safety

- Provider payment IDs are unique and replay-safe.
- Invoice payloads identify internal orders; they do not contain secrets.
- Invite links are limited to one member and expire after 15 minutes.
- Provider webhooks are verified before changing payment state.
- Raw provider events are stored for reconciliation but are not returned by public APIs.
- Refunds revoke access and create an audit event.

## Operational notes

The subscription worker runs with the system bot on persistent deployments. It schedules reminders at 7 days, 3 days, and 24 hours before expiry, then removes expired members and revokes outstanding invites.

For multi-instance deployments, use Supabase/Postgres. The Supabase schema installs `claim_subscription_jobs`, which uses `FOR UPDATE SKIP LOCKED` and lease expiry so multiple worker nodes can safely claim jobs. Each worker has a unique host/process lease identity. Apply the full schema migration before enabling multiple replicas. SQLite is appropriate for a single persistent worker only.

## Current limitations

- Creator payouts and platform revenue sharing are not implemented.
- Telegram Stars are credited to the platform bot; do not advertise automatic creator payouts yet.
- Crypto refunds are not automatic because blockchain transfers require a separate refund transaction.
- Content moderation is intentionally outside the subscription module.
- Real Telegram and NOWPayments sandbox testing is required before production launch.
