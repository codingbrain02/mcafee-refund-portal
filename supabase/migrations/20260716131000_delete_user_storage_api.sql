create or replace function public.get_user_deletion_document_paths(target_user_id uuid)
returns table (storage_path text)
language sql
security definer
set search_path = public
as $$
  with target_user as (
    select portal_user.id, lower(portal_user.email) as email
    from public.users portal_user
    where portal_user.id = target_user_id
  ), target_requests as (
    select distinct request.id
    from public.refund_requests request
    left join public.customers customer on customer.id = request.customer_id
    where request.created_by = target_user_id
       or customer.created_by = target_user_id
       or lower(customer.email) in (select email from target_user)
  )
  select distinct document.storage_path
  from public.refund_documents document
  where document.refund_request_id in (select id from target_requests)
     or document.uploaded_by = target_user_id
$$;

revoke all on function public.get_user_deletion_document_paths(uuid) from public;
grant execute on function public.get_user_deletion_document_paths(uuid) to service_role;

create or replace function public.purge_user_owned_records(target_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
begin
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

  if exists (
    select 1
    from storage.objects object
    join public.refund_documents document on document.storage_path = object.name
    where object.bucket_id = 'refund-documents'
      and (
        document.refund_request_id in (select id from portal_deleted_requests)
        or document.uploaded_by in (select id from portal_deleted_users)
      )
  ) then
    raise exception 'Associated documents must be removed through the Storage API before account deletion.';
  end if;

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
