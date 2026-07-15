create table if not exists public.api_rate_limits (
  rate_limit_key text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now()
);

alter table public.api_rate_limits enable row level security;

create index if not exists api_rate_limits_updated_at_idx
on public.api_rate_limits (updated_at);

create or replace function public.consume_api_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed boolean;
begin
  if trim(coalesce(p_key, '')) = ''
     or p_limit < 1
     or p_window_seconds < 1
     or p_window_seconds > 86400 then
    return false;
  end if;

  delete from public.api_rate_limits
  where updated_at < now() - interval '1 day';

  insert into public.api_rate_limits (
    rate_limit_key,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    p_key,
    now(),
    1,
    now()
  )
  on conflict (rate_limit_key)
  do update
  set
    window_started_at = case
      when public.api_rate_limits.window_started_at
        <= now() - make_interval(secs => p_window_seconds)
      then now()
      else public.api_rate_limits.window_started_at
    end,
    request_count = case
      when public.api_rate_limits.window_started_at
        <= now() - make_interval(secs => p_window_seconds)
      then 1
      else public.api_rate_limits.request_count + 1
    end,
    updated_at = now()
  returning request_count <= p_limit into allowed;

  return coalesce(allowed, false);
end;
$$;

revoke all on table public.api_rate_limits from public, anon, authenticated;
revoke all on function public.consume_api_rate_limit(text, integer, integer)
from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer)
to service_role;

create or replace function public.refund_id_from_storage_path(object_name text)
returns uuid
language plpgsql
immutable
strict
set search_path = public, storage
as $$
declare
  path_parts text[];
begin
  path_parts := storage.foldername(object_name);

  if coalesce(array_length(path_parts, 1), 0) < 1 then
    return null;
  end if;

  return path_parts[1]::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

revoke all on function public.refund_id_from_storage_path(text) from public;
grant execute on function public.refund_id_from_storage_path(text) to authenticated;

drop policy if exists "authenticated users can upload refund documents" on storage.objects;
create policy "authorized users can upload refund documents"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'refund-documents'
  and exists (
    select 1
    from public.refund_requests request
    left join public.customers customer on customer.id = request.customer_id
    left join public.users portal_user on portal_user.id = auth.uid()
    where request.id = public.refund_id_from_storage_path(name)
      and (
        public.current_user_role() in ('refund_manager', 'administrator')
        or request.created_by = auth.uid()
        or lower(customer.email) = lower(portal_user.email)
      )
  )
);

drop policy if exists "authenticated users can upload documents" on public.refund_documents;
create policy "authorized users can upload document records"
on public.refund_documents
for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1
    from public.refund_requests request
    left join public.customers customer on customer.id = request.customer_id
    left join public.users portal_user on portal_user.id = auth.uid()
    where request.id = refund_documents.refund_request_id
      and (
        public.current_user_role() in ('refund_manager', 'administrator')
        or request.created_by = auth.uid()
        or lower(customer.email) = lower(portal_user.email)
      )
  )
);

