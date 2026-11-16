-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

create table if not exists public.jobhunta_workspace (
  id text primary key default 'default',
  settings jsonb not null default '{}'::jsonb,
  auth jsonb,
  thread_owners jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.jobhunta_leads (
  id text primary key,
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
create index if not exists idx_jobhunta_leads_city on public.jobhunta_leads (city);
create index if not exists idx_jobhunta_leads_industry on public.jobhunta_leads (industry);

alter table public.jobhunta_workspace enable row level security;
alter table public.jobhunta_leads enable row level security;

-- Allow access when using SUPABASE_SERVICE_ROLE_KEY or authenticated/anon key for personal workspace
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'jobhunta_workspace' and policyname = 'Allow workspace access'
  ) then
    create policy "Allow workspace access" on public.jobhunta_workspace for all using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'jobhunta_leads' and policyname = 'Allow leads access'
  ) then
    create policy "Allow leads access" on public.jobhunta_leads for all using (true) with check (true);
  end if;
end $$;
