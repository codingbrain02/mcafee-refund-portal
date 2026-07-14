drop policy if exists "customers can view own customer records" on public.customers;
create policy "customers can view own customer records"
on public.customers
for select
using (
  created_by = auth.uid()
  or lower(email) = (
    select lower(portal_user.email)
    from public.users portal_user
    where portal_user.id = auth.uid()
  )
);

drop policy if exists "customers can view own refund requests" on public.refund_requests;
create policy "customers can view own refund requests"
on public.refund_requests
for select
using (
  created_by = auth.uid()
  or exists (
    select 1
    from public.customers customer
    join public.users portal_user on portal_user.id = auth.uid()
    where customer.id = refund_requests.customer_id
      and lower(customer.email) = lower(portal_user.email)
  )
);

drop policy if exists "customers can view own documents" on public.refund_documents;
create policy "customers can view own documents"
on public.refund_documents
for select
using (
  exists (
    select 1
    from public.refund_requests request
    left join public.customers customer on customer.id = request.customer_id
    left join public.users portal_user on portal_user.id = auth.uid()
    where request.id = refund_documents.refund_request_id
      and (
        request.created_by = auth.uid()
        or lower(customer.email) = lower(portal_user.email)
      )
  )
);

drop policy if exists "customers can view own status history" on public.refund_status_history;
create policy "customers can view own status history"
on public.refund_status_history
for select
using (
  exists (
    select 1
    from public.refund_requests request
    left join public.customers customer on customer.id = request.customer_id
    left join public.users portal_user on portal_user.id = auth.uid()
    where request.id = refund_status_history.refund_request_id
      and (
        request.created_by = auth.uid()
        or lower(customer.email) = lower(portal_user.email)
      )
  )
);

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
  select distinct portal_user.id, lower(portal_user.email) as email
  from public.users portal_user
  join unnest(target_user_ids) as user_id on user_id = portal_user.id
  where user_id is not null;

  create temporary table portal_deleted_requests on commit drop as
  select request.id
  from public.refund_requests request
  left join public.customers customer on customer.id = request.customer_id
  where request.created_by in (select id from portal_deleted_users)
     or customer.created_by in (select id from portal_deleted_users)
     or lower(customer.email) in (select email from portal_deleted_users);

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
  where created_by in (select id from portal_deleted_users)
     or lower(email) in (select email from portal_deleted_users);

  delete from public.audit_logs
  where actor_id in (select id from portal_deleted_users)
     or (entity_type = 'user' and entity_id in (select id from portal_deleted_users));
end;
$$;

revoke all on function public.purge_user_owned_records(uuid[]) from public;

create or replace function public.create_staff_refund_request(
  p_customer_full_name text,
  p_customer_email text,
  p_customer_phone text,
  p_reference_number text,
  p_order_number text,
  p_product_name text,
  p_purchase_date date,
  p_amount_requested numeric,
  p_refund_reason text,
  p_preferred_payment_method text,
  p_internal_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_id uuid := auth.uid();
  staff_profile public.users%rowtype;
  normalized_email text := lower(trim(p_customer_email));
  customer_user_id uuid;
  customer_record_id uuid;
  request_id uuid;
begin
  if staff_id is null then
    raise exception 'Authentication is required.';
  end if;

  select *
  into staff_profile
  from public.users
  where id = staff_id;

  if staff_profile.id is null
     or staff_profile.role not in ('refund_manager', 'administrator') then
    raise exception 'Only refund managers and administrators can create requests for customers.';
  end if;

  if nullif(trim(p_customer_full_name), '') is null
     or nullif(normalized_email, '') is null
     or nullif(trim(p_reference_number), '') is null
     or nullif(trim(p_order_number), '') is null
     or nullif(trim(p_product_name), '') is null
     or nullif(trim(p_refund_reason), '') is null
     or nullif(trim(p_preferred_payment_method), '') is null
     or coalesce(p_amount_requested, 0) <= 0 then
    raise exception 'Customer and refund details are required.';
  end if;

  select id
  into customer_user_id
  from public.users
  where lower(email) = normalized_email
  order by created_at asc
  limit 1;

  select id
  into customer_record_id
  from public.customers
  where lower(email) = normalized_email
    and (
      (customer_user_id is not null and created_by = customer_user_id)
      or (customer_user_id is null and created_by is null)
    )
  order by created_at asc
  limit 1;

  if customer_record_id is null then
    insert into public.customers (full_name, email, phone, created_by)
    values (
      trim(p_customer_full_name),
      normalized_email,
      nullif(trim(coalesce(p_customer_phone, '')), ''),
      customer_user_id
    )
    returning id into customer_record_id;
  else
    update public.customers
    set
      full_name = trim(p_customer_full_name),
      phone = nullif(trim(coalesce(p_customer_phone, '')), '')
    where id = customer_record_id;
  end if;

  insert into public.refund_requests (
    customer_id,
    reference_number,
    order_number,
    product_name,
    purchase_date,
    amount_requested,
    refund_reason,
    preferred_payment_method,
    created_by
  )
  values (
    customer_record_id,
    trim(p_reference_number),
    trim(p_order_number),
    trim(p_product_name),
    p_purchase_date,
    p_amount_requested,
    trim(p_refund_reason),
    trim(p_preferred_payment_method),
    customer_user_id
  )
  returning id into request_id;

  insert into public.refund_status_history (
    refund_request_id,
    from_status,
    to_status,
    employee_id,
    internal_notes
  )
  values (
    request_id,
    null,
    'submitted',
    staff_id,
    coalesce(nullif(trim(p_internal_note), ''), 'Staff created refund request on behalf of customer.')
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    staff_id,
    'staff_refund_submitted',
    'refund_request',
    request_id,
    jsonb_build_object(
      'customerEmail', normalized_email,
      'customerName', trim(p_customer_full_name),
      'referenceNumber', trim(p_reference_number),
      'orderNumber', trim(p_order_number),
      'productName', trim(p_product_name),
      'amountRequested', p_amount_requested,
      'actorEmail', staff_profile.email,
      'actorName', staff_profile.full_name,
      'recordedAt', now()
    )
  );

  return request_id;
end;
$$;

revoke all on function public.create_staff_refund_request(
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  numeric,
  text,
  text,
  text
) from public;

grant execute on function public.create_staff_refund_request(
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  numeric,
  text,
  text,
  text
) to authenticated;
