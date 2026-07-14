alter table public.payment_transactions
add column if not exists beneficiary_last4 text
check (beneficiary_last4 is null or beneficiary_last4 ~ '^[0-9]{4}$');

alter table public.notifications
add column if not exists subject text,
add column if not exists body text,
add column if not exists provider text not null default 'resend',
add column if not exists provider_message_id text,
add column if not exists provider_response jsonb not null default '{}'::jsonb,
add column if not exists attempt_count integer not null default 0,
add column if not exists max_attempts integer not null default 3,
add column if not exists next_attempt_at timestamptz not null default now(),
add column if not exists last_attempt_at timestamptz,
add column if not exists last_error text,
add column if not exists credited_at timestamptz,
add column if not exists account_last4 text;

create unique index if not exists notifications_refund_template_channel_unique
on public.notifications (refund_request_id, template, channel)
where refund_request_id is not null;

create policy "employees can view notifications"
on public.notifications
for select
using (public.current_user_role() in ('refund_manager', 'administrator'));

create policy "customers can view own notifications"
on public.notifications
for select
using (
  exists (
    select 1
    from public.refund_requests request
    left join public.customers customer on customer.id = request.customer_id
    left join public.users portal_user on portal_user.id = auth.uid()
    where request.id = notifications.refund_request_id
      and (
        request.created_by = auth.uid()
        or lower(customer.email) = lower(portal_user.email)
      )
  )
);

create or replace function public.enqueue_refund_credited_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_record public.customers%rowtype;
  payment_record public.payment_transactions%rowtype;
  credited_timestamp timestamptz := now();
  account_last4 text;
  notification_subject text;
  notification_body text;
begin
  if new.status <> 'credited'
     or coalesce(old.status::text, '') = 'credited' then
    return new;
  end if;

  select *
  into customer_record
  from public.customers
  where id = new.customer_id;

  if customer_record.email is null then
    return new;
  end if;

  select *
  into payment_record
  from public.payment_transactions
  where refund_request_id = new.id
  order by updated_at desc
  limit 1;

  account_last4 := coalesce(payment_record.beneficiary_last4, '****');
  notification_subject := 'Refund Credited - Ref #' || new.reference_number;
  notification_body :=
    'Hi ' || customer_record.full_name || ',' || chr(10) || chr(10) ||
    'Good news - your refund of USD ' || to_char(new.amount_requested, 'FM999999999.00') ||
    ' has been successfully credited to your bank account ending in ' || account_last4 || '.' ||
    chr(10) || chr(10) ||
    'Refund Reference: ' || new.reference_number || chr(10) ||
    'Original Order: ' || new.order_number || chr(10) ||
    'Credited On: ' || to_char(credited_timestamp, 'YYYY-MM-DD HH24:MI:SS TZ') || chr(10) || chr(10) ||
    'The amount should reflect in your account within 1-3 business days depending on your bank.' ||
    chr(10) || chr(10) ||
    'Thank you,' || chr(10) ||
    new.product_name || ' Refund Processing Portal';

  insert into public.notifications (
    refund_request_id,
    channel,
    recipient,
    template,
    status,
    subject,
    body,
    provider,
    credited_at,
    account_last4,
    next_attempt_at
  )
  values (
    new.id,
    'email',
    customer_record.email,
    'refund_credited',
    'queued',
    notification_subject,
    notification_body,
    'resend',
    credited_timestamp,
    account_last4,
    now()
  )
  on conflict (refund_request_id, template, channel)
  where refund_request_id is not null
  do nothing;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'notification_queued',
    'notification',
    new.id,
    jsonb_build_object(
      'channel', 'email',
      'provider', 'resend',
      'template', 'refund_credited',
      'recipient', customer_record.email,
      'referenceNumber', new.reference_number,
      'recordedAt', credited_timestamp
    )
  );

  return new;
end;
$$;

drop trigger if exists enqueue_refund_credited_email_trigger on public.refund_requests;
create trigger enqueue_refund_credited_email_trigger
after update of status on public.refund_requests
for each row execute function public.enqueue_refund_credited_email();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
