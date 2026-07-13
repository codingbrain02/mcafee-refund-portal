alter table public.users
add column if not exists email_confirmed_at timestamptz,
add column if not exists verification_status text not null default 'pending',
add column if not exists verification_expires_at timestamptz;

alter table public.users
drop constraint if exists users_verification_status_check;

alter table public.users
add constraint users_verification_status_check
check (verification_status in ('pending', 'verified'));

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (
    id,
    role,
    full_name,
    email,
    mfa_required,
    email_confirmed_at,
    verification_status,
    verification_expires_at
  )
  values (
    new.id,
    case
      when lower(new.email) = 'jccodingbrain@gmail.com' then 'administrator'::public.user_role
      else 'customer'::public.user_role
    end,
    case
      when lower(new.email) = 'jccodingbrain@gmail.com' then 'Portal Administrator'
      else coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1), 'Customer')
    end,
    new.email,
    lower(new.email) = 'jccodingbrain@gmail.com',
    new.email_confirmed_at,
    case when new.email_confirmed_at is null then 'pending' else 'verified' end,
    case when new.email_confirmed_at is null then new.created_at + interval '5 days' else null end
  )
  on conflict (id) do update
  set
    email = excluded.email,
    email_confirmed_at = excluded.email_confirmed_at,
    verification_status = excluded.verification_status,
    verification_expires_at = excluded.verification_expires_at,
    updated_at = now()
  where lower(public.users.email) <> 'jccodingbrain@gmail.com';

  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;

create trigger on_auth_user_updated
after update of email, email_confirmed_at on auth.users
for each row execute function public.handle_new_auth_user();

insert into public.users (
  id,
  role,
  full_name,
  email,
  mfa_required,
  email_confirmed_at,
  verification_status,
  verification_expires_at
)
select
  auth_user.id,
  case
    when lower(auth_user.email) = 'jccodingbrain@gmail.com' then 'administrator'::public.user_role
    else 'customer'::public.user_role
  end,
  case
    when lower(auth_user.email) = 'jccodingbrain@gmail.com' then 'Portal Administrator'
    else coalesce(
      nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
      split_part(auth_user.email, '@', 1),
      'Customer'
    )
  end,
  auth_user.email,
  lower(auth_user.email) = 'jccodingbrain@gmail.com',
  auth_user.email_confirmed_at,
  case when auth_user.email_confirmed_at is null then 'pending' else 'verified' end,
  case when auth_user.email_confirmed_at is null then auth_user.created_at + interval '5 days' else null end
from auth.users auth_user
where auth_user.email is not null
on conflict (id) do update
set
  email = excluded.email,
  email_confirmed_at = excluded.email_confirmed_at,
  verification_status = excluded.verification_status,
  verification_expires_at = excluded.verification_expires_at,
  updated_at = now()
where lower(public.users.email) <> 'jccodingbrain@gmail.com';

create or replace function public.delete_user_account(target_user_id uuid, confirmation text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_email text;
begin
  if public.current_user_role() <> 'administrator' then
    raise exception 'Only administrators can delete user accounts.';
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

create or replace function public.cleanup_expired_unverified_users()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  deleted_count integer;
begin
  drop table if exists pg_temp.expired_unverified_users;

  create temporary table expired_unverified_users on commit drop as
  select auth_user.id
  from auth.users auth_user
  where auth_user.email_confirmed_at is null
    and auth_user.created_at < now() - interval '5 days'
    and lower(auth_user.email) <> 'jccodingbrain@gmail.com';

  select count(*) into deleted_count
  from expired_unverified_users;

  delete from public.refund_requests request
  where request.created_by in (select id from expired_unverified_users)
     or exists (
       select 1
       from public.customers customer
       where customer.id = request.customer_id
         and customer.created_by in (select id from expired_unverified_users)
     );

  delete from public.refund_documents
  where uploaded_by in (select id from expired_unverified_users);

  delete from public.internal_notes
  where author_id in (select id from expired_unverified_users);

  delete from public.refund_status_history
  where employee_id in (select id from expired_unverified_users);

  update public.refund_requests
  set assigned_to = null,
      updated_at = now()
  where assigned_to in (select id from expired_unverified_users);

  delete from public.customers
  where created_by in (select id from expired_unverified_users);

  delete from public.audit_logs
  where actor_id in (select id from expired_unverified_users);

  delete from auth.users
  where id in (select id from expired_unverified_users);

  return deleted_count;
end;
$$;

do $$
begin
  create extension if not exists pg_cron with schema extensions;
exception
  when others then
    raise notice 'pg_cron is not available in this project: %', sqlerrm;
end $$;

do $$
begin
  perform cron.unschedule('cleanup-expired-unverified-users');
exception
  when others then
    null;
end $$;

do $$
begin
  perform cron.schedule(
    'cleanup-expired-unverified-users',
    '0 3 * * *',
    'select public.cleanup_expired_unverified_users();'
  );
exception
  when others then
    raise notice 'Could not schedule expired-account cleanup: %', sqlerrm;
end $$;
