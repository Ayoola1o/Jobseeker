begin;

-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

create table if not exists public.jobhunta_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null default '',
  password_hash text not null,
  tier text not null default 'basic',
  results_today integer not null default 0,
  searches_today integer not null default 0,
  emails_today integer not null default 0,
  usage_date text not null default '',
  created_at timestamptz not null default now()
);

alter table public.jobhunta_users add column if not exists results_today integer not null default 0;

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

-- Existing single-user records stay in the private legacy workspace.
alter table public.jobhunta_leads add column if not exists user_id text not null default 'default';

create index if not exists idx_jobhunta_leads_updated_at on public.jobhunta_leads (updated_at desc);
create index if not exists idx_jobhunta_leads_user_id on public.jobhunta_leads (user_id, updated_at desc);
create index if not exists idx_jobhunta_leads_city on public.jobhunta_leads (city);
create index if not exists idx_jobhunta_leads_industry on public.jobhunta_leads (industry);

revoke all on public.jobhunta_users, public.jobhunta_workspace, public.jobhunta_leads from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on public.jobhunta_users, public.jobhunta_workspace, public.jobhunta_leads to service_role;

alter table public.jobhunta_users enable row level security;
alter table public.jobhunta_workspace enable row level security;
alter table public.jobhunta_leads enable row level security;
drop policy if exists "Allow workspace access" on public.jobhunta_workspace;
drop policy if exists "Allow leads access" on public.jobhunta_leads;

create or replace function public.jobhunta_save_workspace(workspace jsonb, lead_rows jsonb, removed_ids text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  owner_id text := workspace ->> 'id';
begin
  insert into public.jobhunta_workspace (id, settings, auth, thread_owners, updated_at)
  select id, settings, auth, thread_owners, updated_at
  from jsonb_populate_record(null::public.jobhunta_workspace, workspace)
  on conflict (id) do update set
    settings = excluded.settings, auth = excluded.auth,
    thread_owners = excluded.thread_owners, updated_at = excluded.updated_at;

  delete from public.jobhunta_leads where user_id = owner_id and id = any(removed_ids);

  insert into public.jobhunta_leads (
    id, user_id, name, industry, city, address, email, phone, website, source,
    platform, rating, open_hours, search_rank, classification, due, about, data, updated_at
  )
  select id, user_id, name, industry, city, address, email, phone, website, source,
    platform, rating, open_hours, search_rank, classification, due, about, data, updated_at
  from jsonb_populate_recordset(null::public.jobhunta_leads, lead_rows)
  where user_id = owner_id
  on conflict (id) do update set
    name = excluded.name, industry = excluded.industry, city = excluded.city,
    address = excluded.address, email = excluded.email, phone = excluded.phone,
    website = excluded.website, source = excluded.source, platform = excluded.platform,
    rating = excluded.rating, open_hours = excluded.open_hours, search_rank = excluded.search_rank,
    classification = excluded.classification, due = excluded.due, about = excluded.about,
    data = excluded.data, updated_at = excluded.updated_at
  where jobhunta_leads.user_id = owner_id;
end;
$$;

revoke all on function public.jobhunta_save_workspace(jsonb, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.jobhunta_save_workspace(jsonb, jsonb, text[]) to service_role;

commit;
