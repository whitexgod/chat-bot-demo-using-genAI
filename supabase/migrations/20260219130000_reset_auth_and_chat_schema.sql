drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists set_profiles_updated_at on public.profiles;
drop function if exists public.handle_new_user();
drop function if exists public.set_updated_at();

drop table if exists public.messages cascade;
drop table if exists public.chats cascade;
drop table if exists public.transactions cascade;
drop table if exists public.profiles cascade;
drop type if exists public.app_role cascade;

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'user');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'user',
  created_at timestamptz default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  amount numeric not null,
  category text,
  merchant text,
  date date not null,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;
alter table public.transactions enable row level security;

create policy "User can view own profile"
on public.profiles
for select
using (id = auth.uid());

create policy "Transactions access control"
on public.transactions
for select
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.profiles
    where public.profiles.id = auth.uid()
    and public.profiles.role = 'admin'
  )
);

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  created_at timestamptz default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references public.chats(id) on delete cascade,
  role text check (role in ('user', 'assistant')),
  content text,
  created_at timestamptz default now()
);
