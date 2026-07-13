do $$
declare
  portal_table text;
  portal_tables text[] := array[
    'users',
    'customers',
    'refund_requests',
    'refund_status_history',
    'internal_notes',
    'audit_logs',
    'payment_transactions'
  ];
begin
  foreach portal_table in array portal_tables loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = portal_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', portal_table);
    end if;
  end loop;
end $$;
