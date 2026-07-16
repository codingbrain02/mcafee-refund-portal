create or replace function public.purge_user_owned_records(target_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  drop table if exists pg_temp.portal_deleted_document_paths;
  drop table if exists pg_temp.portal_deleted_requests;
  drop table if exists pg_temp.portal_deleted_users;

  create temporary table portal_deleted_users on commit drop as
  select distinct target.id, lower(portal_user.email) as email
  from unnest(target_user_ids) as target(id)
  left join public.users portal_user on portal_user.id = target.id
  where target.id is not null;

  create temporary table portal_deleted_requests on commit drop as
  select distinct request.id
  from public.refund_requests request
  left join public.customers customer on customer.id = request.customer_id
  where request.created_by in (select id from portal_deleted_users)
     or customer.created_by in (select id from portal_deleted_users)
     or lower(customer.email) in (
       select email from portal_deleted_users where email is not null
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

  update public.refund_requests request
  set eligible_order_id = null,
      updated_at = now()
  where request.eligible_order_id in (
    select eligible.id
    from public.eligible_orders eligible
    where eligible.created_by in (select id from portal_deleted_users)
       or lower(eligible.customer_email) in (
         select email from portal_deleted_users where email is not null
       )
  );

  delete from public.eligible_orders eligible
  where eligible.created_by in (select id from portal_deleted_users)
     or lower(eligible.customer_email) in (
       select email from portal_deleted_users where email is not null
     );

  delete from public.customers customer
  where customer.created_by in (select id from portal_deleted_users)
     or lower(customer.email) in (
       select email from portal_deleted_users where email is not null
     );

  delete from public.audit_logs audit
  where audit.actor_id in (select id from portal_deleted_users)
     or (
       audit.entity_type in ('user', 'user_account')
       and audit.entity_id in (select id from portal_deleted_users)
     );
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
  target_name text;
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

  select email, full_name
  into target_email, target_name
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
    jsonb_build_object(
      'record_removed', true,
      'targetEmail', target_email,
      'targetName', target_name,
      'recordedAt', now()
    )
  );

  delete from auth.users
  where id = target_user_id;

  if not found then
    raise exception 'Authentication account could not be deleted.';
  end if;
end;
$$;

revoke all on function public.delete_user_account(uuid, text) from public;
grant execute on function public.delete_user_account(uuid, text) to authenticated;
