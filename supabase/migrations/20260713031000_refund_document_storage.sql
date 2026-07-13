insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'refund-documents',
  'refund-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "authenticated users can upload refund documents"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'refund-documents');

create policy "employees can read refund documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'refund-documents'
  and public.current_user_role() in ('refund_manager', 'administrator')
);

create policy "administrators can remove refund documents"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'refund-documents'
  and public.current_user_role() = 'administrator'
);
