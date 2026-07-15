create extension if not exists "pgcrypto";

create type public.user_role as enum ('customer', 'refund_manager', 'administrator');
create type public.refund_status as enum (
  'submitted',
  'under_review',
  'documents_verified',
  'approved',
  'rejected',
  'payment_processing',
  'completed',
  'credited'
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name public.user_role not null unique,
  description text not null,
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'customer',
  full_name text not null,
  email text not null unique,
  mfa_required boolean not null default true,
  locked_until timestamptz,
  email_confirmed_at timestamptz,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified')),
  verification_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create unique index customers_created_by_email_unique
on public.customers (created_by, lower(email))
where created_by is not null;

create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  reference_number text not null unique,
  order_number text not null,
  product_name text not null default 'McAfee',
  purchase_date date,
  amount_requested numeric(12, 2) not null check (amount_requested >= 0),
  refund_reason text not null,
  preferred_payment_method text not null,
  status public.refund_status not null default 'submitted',
  assigned_to uuid references public.users(id),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.refund_documents (
  id uuid primary key default gen_random_uuid(),
  refund_request_id uuid not null references public.refund_requests(id) on delete cascade,
  document_type text not null,
  storage_path text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  file_size_bytes integer not null check (file_size_bytes <= 10485760),
  uploaded_by uuid references public.users(id),
  uploaded_at timestamptz not null default now()
);

create table public.refund_status_history (
  id uuid primary key default gen_random_uuid(),
  refund_request_id uuid not null references public.refund_requests(id) on delete cascade,
  from_status public.refund_status,
  to_status public.refund_status not null,
  employee_id uuid references public.users(id),
  internal_notes text,
  created_at timestamptz not null default now()
);

create table public.internal_notes (
  id uuid primary key default gen_random_uuid(),
  refund_request_id uuid not null references public.refund_requests(id) on delete cascade,
  author_id uuid not null references public.users(id),
  note text not null,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  refund_request_id uuid references public.refund_requests(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  recipient text not null,
  template text not null,
  status text not null default 'queued',
  subject text,
  body text,
  provider text not null default 'resend',
  provider_message_id text,
  provider_response jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_error text,
  credited_at timestamptz,
  account_last4 text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  refund_request_id uuid not null references public.refund_requests(id) on delete cascade,
  provider text not null,
  transaction_reference text not null unique,
  beneficiary_hash text not null,
  beneficiary_last4 text check (beneficiary_last4 is null or beneficiary_last4 ~ '^[0-9]{4}$'),
  amount numeric(12, 2) not null check (amount >= 0),
  status text not null default 'queued',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index notifications_refund_template_channel_unique
on public.notifications (refund_request_id, template, channel)
where refund_request_id is not null;

alter table public.roles enable row level security;
alter table public.users enable row level security;
alter table public.customers enable row level security;
alter table public.refund_requests enable row level security;
alter table public.refund_documents enable row level security;
alter table public.refund_status_history enable row level security;
alter table public.internal_notes enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.payment_transactions enable row level security;

create or replace function public.current_user_role()
returns public.user_role
language sql
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid()
$$;

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

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create trigger on_auth_user_updated
after update of email, email_confirmed_at on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.protect_head_administrator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if lower(new.email) = 'jccodingbrain@gmail.com' then
      new.role := 'administrator';
      new.full_name := 'Portal Administrator';
      new.mfa_required := true;
      new.locked_until := null;
      new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
      new.verification_status := 'verified';
      new.verification_expires_at := null;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if lower(old.email) = 'jccodingbrain@gmail.com' then
      if lower(new.email) <> 'jccodingbrain@gmail.com' then
        raise exception 'The head administrator email cannot be changed.';
      end if;

      new.role := 'administrator';
      new.full_name := 'Portal Administrator';
      new.mfa_required := true;
      new.locked_until := null;
      new.email_confirmed_at := coalesce(new.email_confirmed_at, old.email_confirmed_at, now());
      new.verification_status := 'verified';
      new.verification_expires_at := null;
      new.created_at := old.created_at;

      return new;
    end if;

    if lower(new.email) = 'jccodingbrain@gmail.com' then
      raise exception 'The head administrator email is reserved.';
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' and lower(old.email) = 'jccodingbrain@gmail.com' then
    raise exception 'The head administrator account cannot be deleted.';
  end if;

  return old;
end;
$$;

create trigger protect_head_administrator_insert
before insert on public.users
for each row execute function public.protect_head_administrator();

create trigger protect_head_administrator_update
before update on public.users
for each row execute function public.protect_head_administrator();

create trigger protect_head_administrator_delete
before delete on public.users
for each row execute function public.protect_head_administrator();

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

create trigger enqueue_refund_credited_email_trigger
after update of status on public.refund_requests
for each row execute function public.enqueue_refund_credited_email();

+create or replace function public.enqueue_refund_status_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record public.refund_requests%rowtype;
  customer_record public.customers%rowtype;
  notification_template text;
  notification_subject text;
  notification_body text;
  recorded_at timestamptz := now();
  inserted_rows integer;
begin
  if new.to_status not in ('submitted', 'approved', 'rejected') then
    return new;
  end if;

  select *
  into request_record
  from public.refund_requests
  where id = new.refund_request_id;

  select *
  into customer_record
  from public.customers
  where id = request_record.customer_id;

  if customer_record.email is null then
    return new;
  end if;

  case new.to_status
    when 'submitted' then
      notification_template := 'refund_submitted';
      notification_subject := 'Refund Request Received - Ref #' || request_record.reference_number;
      notification_body :=
        'Hi ' || customer_record.full_name || ',' || chr(10) || chr(10) ||
        'We received your refund request and it is now waiting for review.' || chr(10) || chr(10) ||
        'Refund Reference: ' || request_record.reference_number || chr(10) ||
        'Original Order: ' || request_record.order_number || chr(10) ||
        'Product: ' || request_record.product_name || chr(10) ||
        'Amount Requested: USD ' || to_char(request_record.amount_requested, 'FM999999999.00') || chr(10) ||
        'Submitted On: ' || to_char(recorded_at, 'YYYY-MM-DD HH24:MI:SS TZ') || chr(10) || chr(10) ||
        'You can sign in to the refund portal to track its progress.';
    when 'approved' then
      notification_template := 'refund_approved';
      notification_subject := 'Refund Approved - Ref #' || request_record.reference_number;
      notification_body :=
        'Hi ' || customer_record.full_name || ',' || chr(10) || chr(10) ||
        'Your refund request has been approved and will proceed to payment processing.' || chr(10) || chr(10) ||
        'Refund Reference: ' || request_record.reference_number || chr(10) ||
        'Original Order: ' || request_record.order_number || chr(10) ||
        'Product: ' || request_record.product_name || chr(10) ||
        'Approved Amount: USD ' || to_char(request_record.amount_requested, 'FM999999999.00') || chr(10) ||
        'Approved On: ' || to_char(recorded_at, 'YYYY-MM-DD HH24:MI:SS TZ') || chr(10) || chr(10) ||
        'We will notify you again when the payment has been credited.';
    when 'rejected' then
      notification_template := 'refund_rejected';
      notification_subject := 'Refund Request Decision - Ref #' || request_record.reference_number;
      notification_body :=
        'Hi ' || customer_record.full_name || ',' || chr(10) || chr(10) ||
        'We are unable to approve your refund request.' || chr(10) || chr(10) ||
        'Refund Reference: ' || request_record.reference_number || chr(10) ||
        'Original Order: ' || request_record.order_number || chr(10) ||
        'Product: ' || request_record.product_name || chr(10) ||
        'Reason: ' || coalesce(nullif(trim(new.internal_notes), ''), 'Please contact the refund team for details.') || chr(10) ||
        'Decision Recorded: ' || to_char(recorded_at, 'YYYY-MM-DD HH24:MI:SS TZ');
  end case;

  insert into public.notifications (
    refund_request_id,
    channel,
    recipient,
    template,
    status,
    subject,
    body,
    provider,
    next_attempt_at
  )
  values (
    request_record.id,
    'email',
    customer_record.email,
    notification_template,
    'queued',
    notification_subject,
    notification_body,
    'resend',
    now()
  )
  on conflict (refund_request_id, template, channel)
  where refund_request_id is not null
  do nothing;

  get diagnostics inserted_rows = row_count;

  if inserted_rows > 0 then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(),
      'notification_queued',
      'notification',
      request_record.id,
      jsonb_build_object(
        'channel', 'email',
        'provider', 'resend',
        'template', notification_template,
        'recipient', customer_record.email,
        'referenceNumber', request_record.reference_number,
        'status', new.to_status,
        'recordedAt', recorded_at
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists enqueue_refund_status_email_trigger on public.refund_status_history;
create trigger enqueue_refund_status_email_trigger
after insert on public.refund_status_history
for each row execute function public.enqueue_refund_status_email();

create or replace function public.request_refund_documents(
  p_refund_request_id uuid,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_id uuid := auth.uid();
  staff_profile public.users%rowtype;
  request_record public.refund_requests%rowtype;
  customer_record public.customers%rowtype;
  request_message text := trim(coalesce(p_message, ''));
  recorded_at timestamptz := now();
  inserted_rows integer;
begin
  select *
  into staff_profile
  from public.users
  where id = staff_id;

  if staff_profile.role not in ('refund_manager', 'administrator') then
    raise exception 'Only authorized staff can request customer documents.';
  end if;

  if request_message = '' then
    raise exception 'Enter the documents or information required from the customer.';
  end if;

  select *
  into request_record
  from public.refund_requests
  where id = p_refund_request_id;

  if request_record.id is null then
    raise exception 'Refund request not found.';
  end if;

  if request_record.status <> 'under_review' then
    raise exception 'Documents can only be requested while the refund is under review.';
  end if;

  select *
  into customer_record
  from public.customers
  where id = request_record.customer_id;

  if customer_record.email is null then
    raise exception 'The customer does not have an email address.';
  end if;

  insert into public.notifications (
    refund_request_id,
    channel,
    recipient,
    template,
    status,
    subject,
    body,
    provider,
    next_attempt_at
  )
  values (
    request_record.id,
    'email',
    customer_record.email,
    'documents_requested',
    'queued',
    'Documents Required - Ref #' || request_record.reference_number,
    'Hi ' || customer_record.full_name || ',' || chr(10) || chr(10) ||
      'Additional information is required to continue reviewing your refund request.' || chr(10) || chr(10) ||
      'Refund Reference: ' || request_record.reference_number || chr(10) ||
      'Original Order: ' || request_record.order_number || chr(10) ||
      'Product: ' || request_record.product_name || chr(10) ||
      'Documents or Information Required: ' || request_message || chr(10) ||
      'Requested On: ' || to_char(recorded_at, 'YYYY-MM-DD HH24:MI:SS TZ') || chr(10) || chr(10) ||
      'Please reply through the authorized support channel or upload the requested documents in the portal.',
    'resend',
    now()
  )
  on conflict (refund_request_id, template, channel)
  where refund_request_id is not null
  do nothing;

  get diagnostics inserted_rows = row_count;

  if inserted_rows = 0 then
    raise exception 'Documents have already been requested for this refund.';
  end if;

  insert into public.internal_notes (refund_request_id, author_id, note)
  values (
    request_record.id,
    staff_id,
    'Documents requested from customer: ' || request_message
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    staff_id,
    'documents_requested',
    'refund_request',
    request_record.id,
    jsonb_build_object(
      'actorEmail', staff_profile.email,
      'actorName', staff_profile.full_name,
      'channel', 'email',
      'recipient', customer_record.email,
      'referenceNumber', request_record.reference_number,
      'requestedDocuments', request_message,
      'recordedAt', recorded_at
    )
  );
end;
$$;

revoke all on function public.request_refund_documents(uuid, text) from public;
grant execute on function public.request_refund_documents(uuid, text) to authenticated;


create policy "employees can view refund operations"
on public.refund_requests
for select
using (public.current_user_role() in ('refund_manager', 'administrator'));

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

create policy "customers can create refund requests"
on public.refund_requests
for insert
with check (created_by = auth.uid());

create policy "employees can manage refund requests"
on public.refund_requests
for update
using (
  public.current_user_role() in ('refund_manager', 'administrator')
)
with check (
  public.current_user_role() in ('refund_manager', 'administrator')
);

create policy "employees can view documents"
on public.refund_documents
for select
using (public.current_user_role() in ('refund_manager', 'administrator'));

create policy "authenticated users can upload documents"
on public.refund_documents
for insert
with check (uploaded_by = auth.uid());

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

create policy "administrators can view audit logs"
on public.audit_logs
for select
using (public.current_user_role() = 'administrator');

create policy "authenticated users can create audit logs"
on public.audit_logs
for insert
with check (actor_id = auth.uid());

create policy "portal administrator can manage users"
on public.users
for all
using (public.is_portal_administrator())
with check (public.is_portal_administrator());

create policy "users can read their own profile"
on public.users
for select
using (id = auth.uid() or public.current_user_role() = 'administrator');

create policy "employees can read staff display profiles"
on public.users
for select
using (
  public.current_user_role() in ('refund_manager', 'administrator')
  and role in ('refund_manager', 'administrator')
);

create policy "authenticated users can create own customer profile"
on public.users
for insert
with check (id = auth.uid() and role = 'customer');

create policy "employees can view customers"
on public.customers
for select
using (public.current_user_role() in ('refund_manager', 'administrator'));

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

create policy "customers can create own customer records"
on public.customers
for insert
with check (created_by = auth.uid());

create policy "employees can view status history"
on public.refund_status_history
for select
using (public.current_user_role() in ('refund_manager', 'administrator'));

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

create policy "authenticated users can add status history"
on public.refund_status_history
for insert
with check (
  employee_id = auth.uid()
  or public.current_user_role() in ('refund_manager', 'administrator')
);

create policy "employees can manage internal notes"
on public.internal_notes
for all
using (public.current_user_role() in ('refund_manager', 'administrator'))
with check (public.current_user_role() in ('refund_manager', 'administrator'));

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

create policy "employees can view payment transactions"
on public.payment_transactions
for select
using (public.current_user_role() in ('refund_manager', 'administrator'));

create policy "employees can create payment transactions"
on public.payment_transactions
for insert
with check (public.current_user_role() in ('refund_manager', 'administrator'));

create policy "employees can update payment transactions"
on public.payment_transactions
for update
using (public.current_user_role() in ('refund_manager', 'administrator'))
with check (public.current_user_role() in ('refund_manager', 'administrator'));

insert into public.roles (name, description)
values
  ('customer', 'Can submit and track own refund requests'),
  ('refund_manager', 'Can verify documents and approve or reject assigned refunds'),
  ('administrator', 'Can manage users, permissions, audits, and system settings')
on conflict (name) do nothing;

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

do $$
declare
  portal_table text;
  portal_tables text[] := array[
    'users',
    'customers',
    'refund_requests',
    'refund_status_history',
    'internal_notes',
    'audit_logs',
    'notifications',
    'payment_transactions'
  ];
begin
  foreach portal_table in array portal_tables loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = portal_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', portal_table);
    end if;
  end loop;
end $$;

create table if not exists public.api_rate_limits (
  rate_limit_key text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now()
);

alter table public.api_rate_limits enable row level security;

create index if not exists api_rate_limits_updated_at_idx
on public.api_rate_limits (updated_at);

create or replace function public.consume_api_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed boolean;
begin
  if trim(coalesce(p_key, '')) = ''
     or p_limit < 1
     or p_window_seconds < 1
     or p_window_seconds > 86400 then
    return false;
  end if;

  delete from public.api_rate_limits
  where updated_at < now() - interval '1 day';

  insert into public.api_rate_limits (
    rate_limit_key,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    p_key,
    now(),
    1,
    now()
  )
  on conflict (rate_limit_key)
  do update
  set
    window_started_at = case
      when public.api_rate_limits.window_started_at
        <= now() - make_interval(secs => p_window_seconds)
      then now()
      else public.api_rate_limits.window_started_at
    end,
    request_count = case
      when public.api_rate_limits.window_started_at
        <= now() - make_interval(secs => p_window_seconds)
      then 1
      else public.api_rate_limits.request_count + 1
    end,
    updated_at = now()
  returning request_count <= p_limit into allowed;

  return coalesce(allowed, false);
end;
$$;

revoke all on table public.api_rate_limits from public, anon, authenticated;
revoke all on function public.consume_api_rate_limit(text, integer, integer)
from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer)
to service_role;

create or replace function public.refund_id_from_storage_path(object_name text)
returns uuid
language plpgsql
immutable
strict
set search_path = public, storage
as $$
declare
  path_parts text[];
begin
  path_parts := storage.foldername(object_name);

  if coalesce(array_length(path_parts, 1), 0) < 1 then
    return null;
  end if;

  return path_parts[1]::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

revoke all on function public.refund_id_from_storage_path(text) from public;
grant execute on function public.refund_id_from_storage_path(text) to authenticated;

drop policy if exists "authenticated users can upload refund documents" on storage.objects;
create policy "authorized users can upload refund documents"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'refund-documents'
  and exists (
    select 1
    from public.refund_requests request
    left join public.customers customer on customer.id = request.customer_id
    left join public.users portal_user on portal_user.id = auth.uid()
    where request.id = public.refund_id_from_storage_path(name)
      and (
        public.current_user_role() in ('refund_manager', 'administrator')
        or request.created_by = auth.uid()
        or lower(customer.email) = lower(portal_user.email)
      )
  )
);

drop policy if exists "authenticated users can upload documents" on public.refund_documents;
create policy "authorized users can upload document records"
on public.refund_documents
for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1
    from public.refund_requests request
    left join public.customers customer on customer.id = request.customer_id
    left join public.users portal_user on portal_user.id = auth.uid()
    where request.id = refund_documents.refund_request_id
      and (
        public.current_user_role() in ('refund_manager', 'administrator')
        or request.created_by = auth.uid()
        or lower(customer.email) = lower(portal_user.email)
      )
  )
);
