create or replace function public.execute_query(query_text text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if query_text is null or btrim(query_text) = '' then
    return '[]'::jsonb;
  end if;

  if query_text !~* '^\s*select\s' then
    raise exception 'Only SELECT statements are allowed';
  end if;

  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) as t',
    query_text
  )
  into result;

  return coalesce(result, '[]'::jsonb);
end;
$$;

revoke all on function public.execute_query(text) from public;
grant execute on function public.execute_query(text) to service_role;
