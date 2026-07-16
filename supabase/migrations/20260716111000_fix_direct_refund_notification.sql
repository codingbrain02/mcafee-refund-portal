create or replace function public.submit_customer_refund_request(
  p_order_number text,
  p_product_name text,
  p_refund_reason text
)
returns table (refund_request_id uuid, reference_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_user public.users%rowtype;
  customer_id uuid;
  generated_reference text;
  created_request_id uuid;
begin
  select * into customer_user
  from public.users
  where id = auth.uid();

  if customer_user.id is null or customer_user.role <> 'customer' then
    raise exception 'Only verified customer accounts can submit a refund request.';
  end if;

  if customer_user.email_confirmed_at is null
     or customer_user.verification_status <> 'verified' then
    raise exception 'Verify your email before submitting a refund request.';
  end if;

  if not public.consume_api_rate_limit(
    'refund-submit:' || customer_user.id::text,
    5,
    3600
  ) then
    raise exception 'Too many refund submissions. Try again later.';
  end if;

  if nullif(trim(coalesce(p_order_number, '')), '') is null then
    raise exception 'Enter an order number before continuing.';
  end if;

  if nullif(trim(coalesce(p_product_name, '')), '') is null then
    raise exception 'Select the antivirus product on the order.';
  end if;

  if nullif(trim(coalesce(p_refund_reason, '')), '') is null then
    raise exception 'Select a refund reason before continuing.';
  end if;

  if exists (
    select 1
    from public.refund_requests request
    where request.created_by = customer_user.id
      and lower(request.order_number) = lower(trim(p_order_number))
  ) then
    raise exception 'A refund request already exists for this order number.';
  end if;

  select id into customer_id
  from public.customers
  where created_by = customer_user.id
     or lower(email) = lower(customer_user.email)
  order by created_at asc
  limit 1;

  if customer_id is null then
    insert into public.customers (full_name, email, created_by)
    values (customer_user.full_name, lower(customer_user.email), customer_user.id)
    returning id into customer_id;
  else
    update public.customers
    set
      full_name = customer_user.full_name,
      email = lower(customer_user.email),
      created_by = customer_user.id
    where id = customer_id;
  end if;

  generated_reference := 'REF-' || to_char(now(), 'YYYYMMDD') || '-' ||
    upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));

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
    customer_id,
    generated_reference,
    trim(p_order_number),
    trim(p_product_name),
    null,
    0,
    trim(p_refund_reason),
    'Pending staff verification',
    customer_user.id
  )
  returning id into created_request_id;

  insert into public.refund_status_history (
    refund_request_id,
    from_status,
    to_status,
    employee_id,
    internal_notes
  )
  values (
    created_request_id,
    null,
    'submitted',
    customer_user.id,
    'Customer submitted a refund request pending order verification.'
  );

  update public.notifications as notification
  set body = replace(
    body,
    'Amount Requested: USD 0.00',
    'Refund Amount: Pending staff verification'
  )
  where notification.refund_request_id = created_request_id
    and notification.template = 'refund_submitted';

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    customer_user.id,
    'refund_submitted',
    'refund_request',
    created_request_id,
    jsonb_build_object(
      'actorEmail', customer_user.email,
      'actorName', customer_user.full_name,
      'orderNumber', trim(p_order_number),
      'productName', trim(p_product_name),
      'referenceNumber', generated_reference,
      'recordedAt', now(),
      'source', 'customer_direct_request',
      'orderVerification', 'pending'
    )
  );

  return query select created_request_id, generated_reference;
end;
$$;

revoke all on function public.submit_customer_refund_request(text, text, text) from public;
grant execute on function public.submit_customer_refund_request(text, text, text) to authenticated;
