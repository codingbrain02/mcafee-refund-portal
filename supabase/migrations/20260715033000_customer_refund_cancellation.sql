create or replace function public.cancel_refund_request(
  p_refund_request_id uuid,
  p_confirmation text
)
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text;
  actor_name text;
  owned_request record;
begin
  if actor_id is null or public.current_user_role() <> 'customer' then
    raise exception 'Only the customer who submitted this request can cancel it.';
  end if;

  if p_confirmation <> 'Cancel refund request' then
    raise exception 'Confirmation text does not match.';
  end if;

  select portal_user.email, portal_user.full_name
  into actor_email, actor_name
  from public.users portal_user
  where portal_user.id = actor_id;

  select request.id, request.customer_id, request.status
  into owned_request
  from public.refund_requests request
  join public.customers customer on customer.id = request.customer_id
  where request.id = p_refund_request_id
    and (
      request.created_by = actor_id
      or (
        actor_email is not null
        and lower(customer.email) = lower(actor_email)
      )
    );

  if not found then
    raise exception 'Refund request not found or access denied.';
  end if;

  if owned_request.status <> 'submitted' then
    raise exception 'Only submitted refund requests can be cancelled.';
  end if;

  if exists (
    select 1
    from storage.objects object
    join public.refund_documents document on document.storage_path = object.name
    where object.bucket_id = 'refund-documents'
      and document.refund_request_id = owned_request.id
  ) then
    raise exception 'Uploaded documents must be removed before cancellation.';
  end if;

  delete from public.audit_logs audit
  where (audit.entity_type = 'refund_request' and audit.entity_id = owned_request.id)
     or audit.entity_id in (
       select document.id
       from public.refund_documents document
       where document.refund_request_id = owned_request.id
     );

  delete from public.refund_requests
  where id = owned_request.id;

  delete from public.customers customer
  where customer.id = owned_request.customer_id
    and not exists (
      select 1
      from public.refund_requests request
      where request.customer_id = customer.id
    );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_id,
    'refund_request_cancelled',
    'refund_request',
    null,
    jsonb_build_object(
      'actorEmail', actor_email,
      'actorName', actor_name,
      'recordRemoved', true,
      'recordedAt', now()
    )
  );
end;
$$;

revoke all on function public.cancel_refund_request(uuid, text) from public;
grant execute on function public.cancel_refund_request(uuid, text) to authenticated;

drop policy if exists "customers can read own submitted refund documents" on storage.objects;
create policy "customers can read own submitted refund documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'refund-documents'
  and public.current_user_role() = 'customer'
  and exists (
    select 1
    from public.refund_requests request
    join public.customers customer on customer.id = request.customer_id
    join public.users portal_user on portal_user.id = auth.uid()
    where request.id = public.refund_id_from_storage_path(name)
      and request.status = 'submitted'
      and (
        request.created_by = auth.uid()
        or lower(customer.email) = lower(portal_user.email)
      )
  )
);

drop policy if exists "customers can remove own submitted refund documents" on storage.objects;
create policy "customers can remove own submitted refund documents"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'refund-documents'
  and public.current_user_role() = 'customer'
  and exists (
    select 1
    from public.refund_requests request
    join public.customers customer on customer.id = request.customer_id
    join public.users portal_user on portal_user.id = auth.uid()
    where request.id = public.refund_id_from_storage_path(name)
      and request.status = 'submitted'
      and (
        request.created_by = auth.uid()
        or lower(customer.email) = lower(portal_user.email)
      )
  )
);
