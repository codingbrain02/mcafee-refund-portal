create extension if not exists "pgcrypto";

create type public.user_role as enum ('customer', 'refund_manager', 'administrator');
create type public.refund_status as enum (
  'submitted',
  'under_review',
  'documents_verified',
  'approved',
  'rejected',
  'payment_processing',
  'completed'
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
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  refund_request_id uuid not null references public.refund_requests(id) on delete cascade,
  provider text not null,
  transaction_reference text not null unique,
  beneficiary_hash text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  status text not null default 'queued',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if lower(old.email) = 'jccodingbrain@gmail.com' then
      raise exception 'The head administrator account cannot be changed.';
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

create policy "employees can view refund operations"
on public.refund_requests
for select
using (public.current_user_role() in ('refund_manager', 'administrator'));

create policy "customers can view own refund requests"
on public.refund_requests
for select
using (created_by = auth.uid());

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
    where request.id = refund_documents.refund_request_id
      and request.created_by = auth.uid()
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

create policy "administrators can manage users"
on public.users
for all
using (public.current_user_role() = 'administrator')
with check (public.current_user_role() = 'administrator');

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
using (created_by = auth.uid());

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
    where request.id = refund_status_history.refund_request_id
      and request.created_by = auth.uid()
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
