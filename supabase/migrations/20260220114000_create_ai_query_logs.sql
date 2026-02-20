create table if not exists public.ai_query_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  chat_id uuid references public.chats(id) on delete set null,
  user_message text not null,
  planner jsonb,
  sql_text text not null,
  status text not null check (status in ('generated', 'success', 'error')),
  row_count integer,
  error_message text,
  duration_ms integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ai_query_logs_user_id_created_at_idx
  on public.ai_query_logs (user_id, created_at desc);

create index if not exists ai_query_logs_status_created_at_idx
  on public.ai_query_logs (status, created_at desc);

alter table public.ai_query_logs enable row level security;

drop policy if exists "AI query logs access control" on public.ai_query_logs;
create policy "AI query logs access control"
on public.ai_query_logs
for select
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.profiles
    where public.profiles.id = auth.uid()
    and public.profiles.role = 'admin'
  )
);
