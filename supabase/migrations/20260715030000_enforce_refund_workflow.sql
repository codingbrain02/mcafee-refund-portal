create or replace function public.enforce_refund_workflow_transition()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_role public.user_role := public.current_user_role();
  transition_allowed boolean := false;
begin
  if new.status = old.status then
    raise exception 'Refund status % has already been recorded.', old.status;
  end if;

  if actor_id is null or actor_role not in ('refund_manager', 'administrator') then
    raise exception 'Only authorized staff can change refund status.';
  end if;

  if actor_role = 'refund_manager'
     and old.assigned_to is not null
     and old.assigned_to <> actor_id then
    raise exception 'This refund request is assigned to another handler.';
  end if;

  transition_allowed := case
    when old.status = 'submitted' and new.status = 'under_review' then true
    when old.status = 'under_review' and new.status in ('documents_verified', 'rejected') then true
    when old.status = 'documents_verified' and new.status in ('approved', 'rejected') then true
    when old.status = 'approved' and new.status = 'payment_processing' then true
    when old.status = 'payment_processing' and new.status = 'credited' then true
    else false
  end;

  if not transition_allowed then
    raise exception 'Invalid refund workflow transition from % to %.', old.status, new.status;
  end if;

  if old.status = 'submitted' and new.assigned_to is distinct from actor_id then
    raise exception 'Starting review must assign the request to the active handler.';
  end if;

  if old.assigned_to is not null and new.assigned_to is distinct from old.assigned_to then
    if actor_role <> 'administrator' then
      raise exception 'Only an administrator can reassign a handled refund request.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_refund_workflow_transition_trigger
on public.refund_requests;

create trigger enforce_refund_workflow_transition_trigger
before update of status on public.refund_requests
for each row
execute function public.enforce_refund_workflow_transition();

revoke all on function public.enforce_refund_workflow_transition() from public;
