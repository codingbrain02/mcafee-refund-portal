create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, role, full_name, email, mfa_required)
  values (
    new.id,
    'customer',
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1), 'Customer'),
    new.email,
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

drop policy if exists "authenticated users can create own customer profile" on public.users;
create policy "authenticated users can create own customer profile"
on public.users
for insert
to authenticated
with check (id = auth.uid() and role = 'customer');

drop policy if exists "employees can view customers" on public.customers;
create policy "employees can view customers"
on public.customers
for select
to authenticated
using (public.current_user_role() in ('refund_manager', 'administrator'));

drop policy if exists "customers can view own customer records" on public.customers;
create policy "customers can view own customer records"
on public.customers
for select
to authenticated
using (created_by = auth.uid());

drop policy if exists "customers can create own customer records" on public.customers;
create policy "customers can create own customer records"
on public.customers
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "customers can view own refund requests" on public.refund_requests;
create policy "customers can view own refund requests"
on public.refund_requests
for select
to authenticated
using (created_by = auth.uid());

drop policy if exists "customers can view own documents" on public.refund_documents;
create policy "customers can view own documents"
on public.refund_documents
for select
to authenticated
using (
  exists (
    select 1
    from public.refund_requests request
    where request.id = refund_documents.refund_request_id
      and request.created_by = auth.uid()
  )
);

drop policy if exists "customers can view own status history" on public.refund_status_history;
create policy "customers can view own status history"
on public.refund_status_history
for select
to authenticated
using (
  exists (
    select 1
    from public.refund_requests request
    where request.id = refund_status_history.refund_request_id
      and request.created_by = auth.uid()
  )
);
