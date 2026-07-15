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
