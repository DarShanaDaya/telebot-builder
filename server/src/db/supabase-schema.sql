-- telebot-builder Supabase schema
-- Run this once in the Supabase SQL editor before setting SUPABASE_URL and
-- SUPABASE_SERVICE_ROLE_KEY in your .env.

create table if not exists public.users (
  id text primary key,
  email text unique not null,
  name text,
  password_hash text not null,
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
alter table public.logs enable row level security;
