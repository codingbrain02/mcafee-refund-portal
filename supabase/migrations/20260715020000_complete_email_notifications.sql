create or replace function public.enqueue_refund_status_email()
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

