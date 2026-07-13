create policy "employees can read staff display profiles"
on public.users
for select
to authenticated
using (
  public.current_user_role() in ('refund_manager', 'administrator')
  and role in ('refund_manager', 'administrator')
);
