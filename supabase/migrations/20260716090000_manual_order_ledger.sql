create table if not exists public.eligible_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_email text not null,
  customer_full_name text not null,
  customer_phone text,
  product_name text not null,
  purchase_date date not null,
  refundable_amount numeric(12, 2) not null check (refundable_amount > 0),
  refund_method text not null default 'Original payment method',
  status text not null default 'eligible'
    check (status in ('eligible', 'refund_requested', 'refunded', 'blocked')),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists eligible_orders_customer_email_idx
on public.eligible_orders (lower(customer_email));

alter table public.refund_requests
add column if not exists eligible_order_id uuid references public.eligible_orders(id);

create unique index if not exists refund_requests_eligible_order_unique
on public.refund_requests (eligible_order_id)
where eligible_order_id is not null;

alter table public.eligible_orders enable row level security;

drop policy if exists "staff can view eligible orders" on public.eligible_orders;
create policy "staff can view eligible orders"
on public.eligible_orders
for select
to authenticated
using (public.current_user_role() in ('refund_manager', 'administrator'));

drop policy if exists "staff can create eligible orders" on public.eligible_orders;
create policy "staff can create eligible orders"
on public.eligible_orders
for insert
to authenticated
with check (
  public.current_user_role() in ('refund_manager', 'administrator')
  and created_by = auth.uid()
);

drop policy if exists "staff can update eligible orders" on public.eligible_orders;
create policy "staff can update eligible orders"
on public.eligible_orders
for update
to authenticated
using (public.current_user_role() in ('refund_manager', 'administrator'))
with check (public.current_user_role() in ('refund_manager', 'administrator'));

drop policy if exists "staff can delete unused eligible orders" on public.eligible_orders;
create policy "staff can delete unused eligible orders"
on public.eligible_orders
for delete
to authenticated
using (
  public.current_user_role() in ('refund_manager', 'administrator')
  and not exists (
    select 1
    from public.refund_requests request
    where request.eligible_order_id = eligible_orders.id
  )
);

drop policy if exists "customers can view matching eligible orders" on public.eligible_orders;
create policy "customers can view matching eligible orders"
on public.eligible_orders
for select
to authenticated
using (
  public.current_user_role() = 'customer'
  and lower(customer_email) = lower((select email from public.users where id = auth.uid()))
);

create or replace function public.touch_eligible_order_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_eligible_order_updated_at_trigger on public.eligible_orders;
create trigger touch_eligible_order_updated_at_trigger
before update on public.eligible_orders
for each row execute function public.touch_eligible_order_updated_at();

create or replace function public.submit_eligible_order_refund(
  p_order_id uuid,
  p_refund_reason text
)
returns table (refund_request_id uuid, reference_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_user public.users%rowtype;
  order_record public.eligible_orders%rowtype;
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

  if nullif(trim(coalesce(p_refund_reason, '')), '') is null then
    raise exception 'Select a refund reason before continuing.';
  end if;

  select * into order_record
  from public.eligible_orders
  where id = p_order_id
  for update;

  if order_record.id is null
     or lower(order_record.customer_email) <> lower(customer_user.email) then
    raise exception 'No eligible order was found for this account.';
  end if;

  if order_record.status <> 'eligible' then
    raise exception 'This order is not currently eligible for a new refund request.';
  end if;

  if exists (
    select 1 from public.refund_requests request
    where request.eligible_order_id = order_record.id
  ) then
    raise exception 'A refund request already exists for this order.';
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
      order_record.customer_full_name,
      lower(order_record.customer_email),
      order_record.customer_phone,
      customer_user.id
    )
    returning id into customer_id;
  else
    update public.customers
    set
      full_name = order_record.customer_full_name,
      phone = order_record.customer_phone,
      created_by = customer_user.id
    where id = customer_id;
  end if;

  generated_reference := 'REF-' || to_char(now(), 'YYYYMMDD') || '-' ||
    upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));

  insert into public.refund_requests (
    customer_id,
    eligible_order_id,
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
    order_record.id,
    generated_reference,
    order_record.order_number,
    order_record.product_name,
    order_record.purchase_date,
    order_record.refundable_amount,
    trim(p_refund_reason),
    order_record.refund_method,
    customer_user.id
  )
  returning id into created_request_id;

  update public.eligible_orders
  set status = 'refund_requested'
  where id = order_record.id;

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
    'Customer submitted a verified eligible-order refund request.'
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    customer_user.id,
    'refund_submitted',
    'refund_request',
    created_request_id,
    jsonb_build_object(
      'actorEmail', customer_user.email,
      'actorName', customer_user.full_name,
      'orderNumber', order_record.order_number,
      'referenceNumber', generated_reference,
      'recordedAt', now(),
      'source', 'verified_manual_order'
    )
  );

  return query select created_request_id, generated_reference;
end;
$$;

revoke all on function public.submit_eligible_order_refund(uuid, text) from public;
grant execute on function public.submit_eligible_order_refund(uuid, text) to authenticated;

create or replace function public.sync_eligible_order_from_refund()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.eligible_order_id is not null and old.status = 'submitted' then
      update public.eligible_orders
      set status = 'eligible'
      where id = old.eligible_order_id;
    end if;
    return old;
  end if;

  if new.eligible_order_id is not null and new.status in ('credited', 'completed') then
    update public.eligible_orders
    set status = 'refunded'
    where id = new.eligible_order_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_eligible_order_status_trigger on public.refund_requests;
create trigger sync_eligible_order_status_trigger
after update of status on public.refund_requests
for each row execute function public.sync_eligible_order_from_refund();

drop trigger if exists release_eligible_order_on_refund_delete_trigger on public.refund_requests;
create trigger release_eligible_order_on_refund_delete_trigger
after delete on public.refund_requests
for each row execute function public.sync_eligible_order_from_refund();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'eligible_orders'
  ) then
    alter publication supabase_realtime add table public.eligible_orders;
  end if;
end $$;
