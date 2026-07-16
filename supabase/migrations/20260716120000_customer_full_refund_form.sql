alter table public.refund_requests
  add column if not exists customer_phone_submitted text,
  add column if not exists customer_purchase_date date,
  add column if not exists customer_requested_amount numeric(12, 2)
    check (customer_requested_amount is null or customer_requested_amount > 0),
  add column if not exists customer_preferred_payment_method text;

revoke execute on function public.submit_customer_refund_request(text, text, text) from authenticated;

create or replace function public.submit_customer_refund_request_details(
  p_order_number text,
  p_product_name text,
  p_customer_phone text,
  p_purchase_date date,
  p_requested_amount numeric,
  p_preferred_payment_method text,
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

  if nullif(trim(coalesce(p_customer_phone, '')), '') is null then
    raise exception 'Enter a customer phone number.';
  end if;

  if p_purchase_date is null or p_purchase_date > current_date then
    raise exception 'Enter a valid purchase date.';
  end if;

  if p_requested_amount is null or p_requested_amount <= 0 then
    raise exception 'Enter a requested amount greater than zero.';
  end if;

  if nullif(trim(coalesce(p_preferred_payment_method, '')), '') is null then
    raise exception 'Select a preferred refund method.';
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
    insert into public.customers (full_name, email, phone, created_by)
    values (
      customer_user.full_name,
      lower(customer_user.email),
      trim(p_customer_phone),
      customer_user.id
    )
    returning id into customer_id;
  else
    update public.customers
    set
      full_name = customer_user.full_name,
      email = lower(customer_user.email),
      phone = trim(p_customer_phone),
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
    customer_phone_submitted,
    customer_purchase_date,
    customer_requested_amount,
    customer_preferred_payment_method,
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
    trim(p_customer_phone),
    p_purchase_date,
    round(p_requested_amount, 2),
    trim(p_preferred_payment_method),
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
    'Customer submitted a full refund request pending staff verification.'
  );

  update public.notifications as notification
  set body = replace(
    body,
    'Amount Requested: USD 0.00',
    'Customer Requested Amount: USD ' ||
      to_char(round(p_requested_amount, 2), 'FM999999999.00') ||
      ' (pending staff verification)'
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
      'customerRequestedAmount', round(p_requested_amount, 2),
      'customerPurchaseDate', p_purchase_date,
      'customerPreferredMethod', trim(p_preferred_payment_method),
      'referenceNumber', generated_reference,
      'recordedAt', now(),
      'source', 'customer_full_refund_form',
      'orderVerification', 'pending'
    )
  );

  return query select created_request_id, generated_reference;
end;
$$;

revoke all on function public.submit_customer_refund_request_details(
  text,
  text,
  text,
  date,
  numeric,
  text,
  text
) from public;
grant execute on function public.submit_customer_refund_request_details(
  text,
  text,
  text,
  date,
  numeric,
  text,
  text
) to authenticated;
