with ranked_customers as (
  select
    id,
    first_value(id) over (
      partition by created_by, lower(email)
      order by created_at asc, id asc
    ) as keeper_id
  from public.customers
  where created_by is not null
)
update public.refund_requests request
set customer_id = ranked.keeper_id
from ranked_customers ranked
where request.customer_id = ranked.id
  and ranked.id <> ranked.keeper_id;

with ranked_customers as (
  select
    id,
    first_value(id) over (
      partition by created_by, lower(email)
      order by created_at asc, id asc
    ) as keeper_id
  from public.customers
  where created_by is not null
)
delete from public.customers customer
using ranked_customers ranked
where customer.id = ranked.id
  and ranked.id <> ranked.keeper_id;

create unique index if not exists customers_created_by_email_unique
on public.customers (created_by, lower(email))
where created_by is not null;
