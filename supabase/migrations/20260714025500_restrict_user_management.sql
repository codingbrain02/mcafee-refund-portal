create or replace function public.is_portal_administrator()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid()
      and role = 'administrator'
      and lower(email) = 'jccodingbrain@gmail.com'
  )
$$;

drop policy if exists "administrators can manage users" on public.users;

create policy "portal administrator can manage users"
on public.users
for all
using (public.is_portal_administrator())
with check (public.is_portal_administrator());

create or replace function public.delete_user_account(target_user_id uuid, confirmation text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_email text;
begin
  if not public.is_portal_administrator() then
    raise exception 'Only the portal administrator can delete user accounts.';
  end if;

  if auth.uid() = target_user_id then
    raise exception 'You cannot delete the account for the active session.';
  end if;

  if confirmation <> 'Delete user account' then
    raise exception 'Confirmation text does not match.';
  end if;

  select email into target_email
  from public.users
  where id = target_user_id;

  if target_email is null then
    raise exception 'User account not found.';
  end if;

  if lower(target_email) = 'jccodingbrain@gmail.com' then
    raise exception 'The head administrator account cannot be deleted.';
  end if;

  delete from public.refund_requests request
  where request.created_by = target_user_id
     or exists (
       select 1
       from public.customers customer
       where customer.id = request.customer_id
         and customer.created_by = target_user_id
     );

  delete from public.refund_documents
  where uploaded_by = target_user_id;

  delete from public.internal_notes
  where author_id = target_user_id;

  delete from public.refund_status_history
  where employee_id = target_user_id;

  update public.refund_requests
  set assigned_to = null,
      updated_at = now()
  where assigned_to = target_user_id;

  delete from public.customers
  where created_by = target_user_id;

  delete from public.audit_logs
  where actor_id = target_user_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'user_account_deleted',
    'user',
    target_user_id,
    jsonb_build_object('email', target_email)
  );

  delete from auth.users
  where id = target_user_id;
end;
$$;

revoke all on function public.delete_user_account(uuid, text) from public;
grant execute on function public.delete_user_account(uuid, text) to authenticated;
