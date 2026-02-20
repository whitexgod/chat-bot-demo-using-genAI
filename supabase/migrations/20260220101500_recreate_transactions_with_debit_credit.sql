drop table if exists public.transactions cascade;

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(12, 2) not null,
  debit numeric(12, 2) not null default 0,
  credit numeric(12, 2) not null default 0,
  category text,
  merchant text,
  date date not null,
  created_at timestamptz default now(),
  constraint transactions_debit_non_negative check (debit >= 0),
  constraint transactions_credit_non_negative check (credit >= 0),
  constraint transactions_single_direction check (debit = 0 or credit = 0),
  constraint transactions_non_zero_value check (debit + credit > 0),
  constraint transactions_amount_matches_flow check (amount = credit - debit)
);

create index transactions_user_id_date_idx on public.transactions (user_id, date desc);

alter table public.transactions enable row level security;

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
