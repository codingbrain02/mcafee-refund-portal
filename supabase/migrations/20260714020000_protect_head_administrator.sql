update public.users
set
  role = 'administrator',
  full_name = 'Portal Administrator',
  mfa_required = true,
  locked_until = null,
  updated_at = now()
where lower(email) = 'jccodingbrain@gmail.com';

create or replace function public.protect_head_administrator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and lower(new.email) = 'jccodingbrain@gmail.com' then
    new.role := 'administrator';
    new.full_name := 'Portal Administrator';
    new.mfa_required := true;
    new.locked_until := null;
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

drop trigger if exists protect_head_administrator_insert on public.users;
drop trigger if exists protect_head_administrator_update on public.users;
drop trigger if exists protect_head_administrator_delete on public.users;

create trigger protect_head_administrator_insert
before insert on public.users
for each row execute function public.protect_head_administrator();

create trigger protect_head_administrator_update
before update on public.users
for each row execute function public.protect_head_administrator();

create trigger protect_head_administrator_delete
before delete on public.users
for each row execute function public.protect_head_administrator();
