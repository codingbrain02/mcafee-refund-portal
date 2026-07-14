create or replace function public.purge_user_owned_records(target_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  drop table if exists pg_temp.portal_deleted_users;
  drop table if exists pg_temp.portal_deleted_requests;
  drop table if exists pg_temp.portal_deleted_document_paths;

  create temporary table portal_deleted_users on commit drop as
  select distinct user_id as id
  from unnest(target_user_ids) as user_id
  where user_id is not null;

  create temporary table portal_deleted_requests on commit drop as
  select request.id
  from public.refund_requests request
  where request.created_by in (select id from portal_deleted_users)
     or exists (
       select 1
       from public.customers customer
       where customer.id = request.customer_id
         and customer.created_by in (select id from portal_deleted_users)
     );

  create temporary table portal_deleted_document_paths on commit drop as
  select distinct document.storage_path
  from public.refund_documents document
  where document.refund_request_id in (select id from portal_deleted_requests)
     or document.uploaded_by in (select id from portal_deleted_users);

  delete from storage.objects object
  where object.bucket_id = 'refund-documents'
    and object.name in (select storage_path from portal_deleted_document_paths);

  delete from public.refund_requests
  where id in (select id from portal_deleted_requests);

  delete from public.refund_documents
  where uploaded_by in (select id from portal_deleted_users);

  delete from public.internal_notes
  where author_id in (select id from portal_deleted_users);

  delete from public.refund_status_history
  where employee_id in (select id from portal_deleted_users);

  update public.refund_requests
  set assigned_to = null,
      updated_at = now()
  where assigned_to in (select id from portal_deleted_users);

  delete from public.customers
  where created_by in (select id from portal_deleted_users);

  delete from public.audit_logs
  where actor_id in (select id from portal_deleted_users)
     or (entity_type = 'user' and entity_id in (select id from portal_deleted_users));
end;
$$;

revoke all on function public.purge_user_owned_records(uuid[]) from public;

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

  perform public.purge_user_owned_records(array[target_user_id]);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'user_account_deleted',
    'user_account',
    null,
    jsonb_build_object('record_removed', true)
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
  expired_ids uuid[];
begin
  drop table if exists pg_temp.expired_unverified_users;

  create temporary table expired_unverified_users on commit drop as
  select auth_user.id
  from auth.users auth_user
  where auth_user.email_confirmed_at is null
    and auth_user.created_at < now() - interval '5 days'
    and lower(auth_user.email) <> 'jccodingbrain@gmail.com';

  select count(*), coalesce(array_agg(id), array[]::uuid[])
  into deleted_count, expired_ids
  from expired_unverified_users;

  perform public.purge_user_owned_records(expired_ids);

  delete from auth.users
  where id in (select id from expired_unverified_users);

  return deleted_count;
end;
$$;
