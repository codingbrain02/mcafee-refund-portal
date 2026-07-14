alter table public.refund_requests
add column if not exists product_name text not null default 'McAfee';
