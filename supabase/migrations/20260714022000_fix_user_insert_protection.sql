create or replace function public.protect_head_administrator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if lower(new.email) = 'jccodingbrain@gmail.com' then
      new.role := 'administrator';
      new.full_name := 'Portal Administrator';
      new.mfa_required := true;
      new.locked_until := null;
    end if;

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

insert into public.users (id, role, full_name, email, mfa_required)
select
  auth_user.id,
  case
    when lower(auth_user.email) = 'jccodingbrain@gmail.com' then 'administrator'::public.user_role
    else 'customer'::public.user_role
  end,
  case
    when lower(auth_user.email) = 'jccodingbrain@gmail.com' then 'Portal Administrator'
    else coalesce(
      nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
      split_part(auth_user.email, '@', 1),
      'Customer'
    )
  end,
  auth_user.email,
  lower(auth_user.email) = 'jccodingbrain@gmail.com'
from auth.users auth_user
where auth_user.email is not null
  and not exists (
    select 1
    from public.users app_user
    where app_user.id = auth_user.id
  )
  and not exists (
    select 1
    from public.users app_user
    where lower(app_user.email) = lower(auth_user.email)
  );
