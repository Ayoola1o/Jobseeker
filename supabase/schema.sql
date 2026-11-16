-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

create table if not exists public.jobhunta_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null default '',
  password_hash text not null,
  tier text not null default 'basic',
  searches_today integer not null default 0,
  emails_today integer not null default 0,
  usage_date text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_jobhunta_users_email on public.jobhunta_users (email);

create table if not exists public.jobhunta_workspace (
  id text primary key default 'default',
  settings jsonb not null default '{}'::jsonb,
  auth jsonb,
  thread_owners jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.jobhunta_leads (
  id text primary key,
  user_id text not null default 'default',
  name text not null,
  industry text default '',
  city text default '',
  address text default '',
  email text default '',
  phone text default '',
  website text default '',
  source text default '',
  platform text default '',
  rating text default '',
  open_hours text default '',
  search_rank integer,
  classification text default '',
  due text default '',
  about text default '',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_jobhunta_leads_updated_at on public.jobhunta_leads (updated_at desc);
create index if not exists idx_jobhunta_leads_user_id on public.jobhunta_leads (user_id, updated_at desc);
create index if not exists idx_jobhunta_leads_city on public.jobhunta_leads (city);
create index if not exists idx_jobhunta_leads_industry on public.jobhunta_leads (industry);

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on table public.jobhunta_users to anon, authenticated, service_role;
grant select, insert, update, delete on table public.jobhunta_workspace to anon, authenticated, service_role;
grant select, insert, update, delete on table public.jobhunta_leads to anon, authenticated, service_role;

alter table public.jobhunta_users enable row level security;
alter table public.jobhunta_workspace enable row level security;
alter table public.jobhunta_leads enable row level security;
