alter table public.ai_query_logs
add column if not exists parsed_query jsonb;
