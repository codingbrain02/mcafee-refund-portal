-- Reset all portal activity while preserving verified authentication accounts.
delete from public.payment_transactions;
delete from public.notifications;
delete from public.internal_notes;
delete from public.refund_status_history;
delete from public.refund_documents;
delete from public.refund_requests;
delete from public.eligible_orders;
delete from public.customers;
delete from public.audit_logs;
delete from public.api_rate_limits;

delete from auth.users
where email_confirmed_at is null
  and lower(email) <> 'jccodingbrain@gmail.com';

update public.users portal_user
set
  email_confirmed_at = coalesce(portal_user.email_confirmed_at, auth_user.email_confirmed_at, now()),
  verification_status = 'verified',
  verification_expires_at = null,
  updated_at = now()
from auth.users auth_user
where auth_user.id = portal_user.id
  and (
    auth_user.email_confirmed_at is not null
    or lower(auth_user.email) = 'jccodingbrain@gmail.com'
  );

delete from public.users
where verification_status <> 'verified'
  and lower(email) <> 'jccodingbrain@gmail.com';
