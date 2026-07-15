create or replace function public.is_head_portal_administrator(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users portal_user
    where portal_user.id = p_user_id
      and lower(portal_user.email) = 'jccodingbrain@gmail.com'
  )
$$;

revoke all on function public.is_head_portal_administrator(uuid) from public;
grant execute on function public.is_head_portal_administrator(uuid) to authenticated;

drop policy if exists "users can read their own profile" on public.users;
create policy "users can read their own profile"
on public.users
for select
to authenticated
using (
  id = auth.uid()
  or (
    public.current_user_role() = 'administrator'
    and (
      public.is_portal_administrator()
      or not public.is_head_portal_administrator(id)
    )
  )
);

drop policy if exists "employees can read staff display profiles" on public.users;
create policy "employees can read staff display profiles"
on public.users
for select
to authenticated
using (
  public.current_user_role() in ('refund_manager', 'administrator')
  and role in ('refund_manager', 'administrator')
  and (
    public.is_portal_administrator()
    or not public.is_head_portal_administrator(id)
  )
);

drop policy if exists "administrators can view audit logs" on public.audit_logs;
create policy "administrators can view audit logs"
on public.audit_logs
for select
to authenticated
using (
  public.current_user_role() = 'administrator'
  and (
    public.is_portal_administrator()
    or (
      not public.is_head_portal_administrator(actor_id)
      and not public.is_head_portal_administrator(entity_id)
      and lower(coalesce(metadata ->> 'actorEmail', '')) <> 'jccodingbrain@gmail.com'
      and lower(coalesce(metadata ->> 'targetEmail', '')) <> 'jccodingbrain@gmail.com'
      and lower(coalesce(metadata ->> 'email', '')) <> 'jccodingbrain@gmail.com'
    )
  )
);
