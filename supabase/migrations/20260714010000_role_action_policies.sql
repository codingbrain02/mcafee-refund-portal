drop policy if exists "managers can update assigned refund requests" on public.refund_requests;
create policy "employees can manage refund requests"
on public.refund_requests
for update
to authenticated
using (public.current_user_role() in ('refund_manager', 'administrator'))
with check (public.current_user_role() in ('refund_manager', 'administrator'));

drop policy if exists "administrators can view payment transactions" on public.payment_transactions;
create policy "employees can view payment transactions"
on public.payment_transactions
for select
to authenticated
using (public.current_user_role() in ('refund_manager', 'administrator'));

create policy "employees can create payment transactions"
on public.payment_transactions
for insert
to authenticated
with check (public.current_user_role() in ('refund_manager', 'administrator'));

create policy "employees can update payment transactions"
on public.payment_transactions
for update
to authenticated
using (public.current_user_role() in ('refund_manager', 'administrator'))
with check (public.current_user_role() in ('refund_manager', 'administrator'));

create policy "authenticated users can create audit logs"
on public.audit_logs
for insert
to authenticated
with check (actor_id = auth.uid());

drop policy if exists "employees can add status history" on public.refund_status_history;
create policy "authenticated users can add status history"
on public.refund_status_history
for insert
to authenticated
with check (
  employee_id = auth.uid()
  or public.current_user_role() in ('refund_manager', 'administrator')
);
