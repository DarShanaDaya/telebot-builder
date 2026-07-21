-- telebot-builder Supabase schema
-- Run this once in the Supabase SQL editor before setting SUPABASE_URL and
-- SUPABASE_SERVICE_ROLE_KEY in your .env.

create table if not exists public.users (
  id text primary key,
  email text unique not null,
  name text,
  password_hash text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.bots (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  name text not null,
  token_enc text not null,
  username text,
  mode text not null default 'polling',
  status text not null default 'stopped',
  webhook_secret text not null,
  flow_draft text,
  flow_published text,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bots_user on public.bots(user_id);

create table if not exists public.credentials (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  name text not null,
  type text not null,
  data_enc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_credentials_user on public.credentials(user_id);

create table if not exists public.sessions (
  id text primary key,
  bot_id text not null references public.bots(id) on delete cascade,
  chat_id text not null,
  user_json text,
  node_id text,
  status text not null default 'idle',
  variables text not null default '{}',
  pending text,
  last_activity timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (bot_id, chat_id)
);
create index if not exists idx_sessions_bot on public.sessions(bot_id);

create table if not exists public.processed_updates (
  bot_id text not null references public.bots(id) on delete cascade,
  update_id text not null,
  created_at timestamptz not null default now(),
  primary key (bot_id, update_id)
);
create index if not exists idx_processed_updates_created on public.processed_updates(created_at);

create table if not exists public.logs (
  id bigint generated always as identity primary key,
  bot_id text not null references public.bots(id) on delete cascade,
  chat_id text,
  level text not null default 'info',
  message text not null,
  data text,
  created_at timestamptz not null default now()
);
create index if not exists idx_logs_bot on public.logs(bot_id, id desc);

-- Row Level Security: the platform connects with the service role key which
-- bypasses RLS. Enabling RLS keeps the anon key locked out.
alter table public.users enable row level security;
alter table public.bots enable row level security;
alter table public.credentials enable row level security;
alter table public.sessions enable row level security;
alter table public.processed_updates enable row level security;
alter table public.logs enable row level security;


-- Subscription management ---------------------------------------------------
create table if not exists public.subscription_chats (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  telegram_chat_id text not null,
  chat_type text not null,
  title text,
  username text,
  status text not null default 'active',
  permissions_json text not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, telegram_chat_id)
);
create index if not exists idx_subscription_chats_user on public.subscription_chats(user_id);
create index if not exists idx_subscription_chats_telegram on public.subscription_chats(telegram_chat_id);

create table if not exists public.subscription_plans (
  id text primary key,
  chat_id text not null references public.subscription_chats(id) on delete cascade,
  name text not null,
  description text,
  duration_value integer,
  duration_unit text,
  is_lifetime boolean not null default false,
  price_stars integer,
  price_fiat_amount numeric,
  price_fiat_currency text,
  crypto_currency text,
  currency text not null default 'XTR',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_subscription_plans_chat on public.subscription_plans(chat_id);

create table if not exists public.subscription_orders (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  plan_id text not null references public.subscription_plans(id),
  chat_id text not null references public.subscription_chats(id),
  telegram_user_id text not null,
  status text not null default 'pending',
  invoice_payload text not null unique,
  plan_name_snapshot text not null,
  duration_value_snapshot integer,
  duration_unit_snapshot text,
  is_lifetime_snapshot boolean not null default false,
  price_snapshot integer not null,
  currency_snapshot text not null,
  payment_amount_snapshot numeric,
  payment_currency_snapshot text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists idx_subscription_orders_user on public.subscription_orders(user_id);
create index if not exists idx_subscription_orders_customer on public.subscription_orders(telegram_user_id);

create table if not exists public.subscription_payments (
  id text primary key,
  order_id text not null references public.subscription_orders(id) on delete cascade,
  provider text not null,
  provider_payment_id text not null,
  provider_event_id text,
  status text not null,
  amount numeric not null,
  currency text not null,
  charge_id text,
  raw_event_json text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_payment_id),
  unique(provider, provider_event_id)
);
create index if not exists idx_subscription_payments_order on public.subscription_payments(order_id);

create table if not exists public.subscription_entitlements (
  id text primary key,
  order_id text not null unique references public.subscription_orders(id) on delete cascade,
  chat_id text not null references public.subscription_chats(id) on delete cascade,
  telegram_user_id text not null,
  status text not null default 'pending',
  starts_at timestamptz,
  expires_at timestamptz,
  joined_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_subscription_entitlements_chat_user on public.subscription_entitlements(chat_id, telegram_user_id);
create index if not exists idx_subscription_entitlements_expiry on public.subscription_entitlements(status, expires_at);

create table if not exists public.subscription_invite_links (
  id text primary key,
  entitlement_id text not null references public.subscription_entitlements(id) on delete cascade,
  telegram_chat_id text not null,
  invite_link text not null unique,
  status text not null default 'issued',
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists idx_subscription_invites_entitlement on public.subscription_invite_links(entitlement_id);

create table if not exists public.subscription_jobs (
  id text primary key,
  job_type text not null,
  entity_id text not null,
  run_at timestamptz not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  claimed_at timestamptz,
  claimed_by text,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique(job_type, entity_id)
);
create index if not exists idx_subscription_jobs_due on public.subscription_jobs(status, run_at);

create table if not exists public.subscription_audit_logs (
  id bigint generated always as identity primary key,
  user_id text references public.users(id) on delete set null,
  chat_id text,
  telegram_user_id text,
  action text not null,
  entity_type text,
  entity_id text,
  data text,
  created_at timestamptz not null default now()
);
create index if not exists idx_subscription_audit_user on public.subscription_audit_logs(user_id, id desc);

create table if not exists public.subscription_connection_codes (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  code_hash text not null unique,
  telegram_user_id text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_subscription_connection_codes_user on public.subscription_connection_codes(user_id, expires_at);

create table if not exists public.subscription_telegram_accounts (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  telegram_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, telegram_user_id)
);
create index if not exists idx_subscription_telegram_accounts_user on public.subscription_telegram_accounts(user_id);

-- Platform-wide "main" subscription, configured by an admin from the Admin
-- console. A single row (id = 'main') holds the current offer.
create table if not exists public.main_subscription (
  id text primary key,
  name text not null,
  description text,
  duration_value integer,
  duration_unit text,
  is_lifetime boolean not null default false,
  price_stars integer,
  price_fiat_amount numeric,
  price_fiat_currency text,
  crypto_currency text,
  currency text not null default 'XTR',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscription_chats enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.subscription_orders enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.subscription_entitlements enable row level security;
alter table public.subscription_invite_links enable row level security;
alter table public.subscription_jobs enable row level security;
alter table public.subscription_audit_logs enable row level security;
alter table public.subscription_connection_codes enable row level security;
alter table public.subscription_telegram_accounts enable row level security;
alter table public.main_subscription enable row level security;

-- Additive migration for existing Supabase installations.
alter table public.users add column if not exists is_admin boolean not null default false;
alter table public.subscription_orders add column if not exists payment_amount_snapshot numeric;
alter table public.subscription_orders add column if not exists payment_currency_snapshot text;

-- Crypto providers may return decimal asset amounts.
alter table public.subscription_payments alter column amount type numeric using amount::numeric;


-- Distributed worker claim: requires Postgres/Supabase for multi-node mode.
alter table public.subscription_jobs add column if not exists claimed_by text;
alter table public.subscription_jobs add column if not exists lease_until timestamptz;

create or replace function public.claim_subscription_jobs(
  p_worker_id text,
  p_limit integer default 25,
  p_lease_seconds integer default 120
)
returns setof public.subscription_jobs
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select id
    from public.subscription_jobs
    where (status = 'pending' and run_at <= now())
       or (status = 'running' and lease_until is not null and lease_until <= now())
    order by run_at asc
    for update skip locked
    limit greatest(1, least(p_limit, 500))
  )
  update public.subscription_jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         claimed_at = now(),
         claimed_by = p_worker_id,
         lease_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 3600)))
    from candidates c
   where j.id = c.id
  returning j.*;
$$;
