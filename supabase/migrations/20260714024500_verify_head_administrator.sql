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
      new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
      new.verification_status := 'verified';
      new.verification_expires_at := null;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if lower(old.email) = 'jccodingbrain@gmail.com' then
      if lower(new.email) <> 'jccodingbrain@gmail.com' then
        raise exception 'The head administrator email cannot be changed.';
      end if;

      new.role := 'administrator';
      new.full_name := 'Portal Administrator';
      new.mfa_required := true;
      new.locked_until := null;
      new.email_confirmed_at := coalesce(new.email_confirmed_at, old.email_confirmed_at, now());
      new.verification_status := 'verified';
      new.verification_expires_at := null;
      new.created_at := old.created_at;

      return new;
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

update public.users
set
  role = 'administrator',
  full_name = 'Portal Administrator',
  mfa_required = true,
  locked_until = null,
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  verification_status = 'verified',
  verification_expires_at = null,
  updated_at = now()
where lower(email) = 'jccodingbrain@gmail.com';
