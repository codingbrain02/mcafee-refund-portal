# Technical Architecture

## Components

- `src`: React role-based portal and Supabase browser client.
- `api`: Vercel functions for health, Resend queue delivery, and signed document links.
- `server`: shared server-side authentication, validation, and rate-limit helpers.
- `supabase/migrations`: PostgreSQL schema evolution, RLS, triggers, and protected functions.
- `tests`: Node-based security and release checks.

## Data flow

1. Supabase Auth restores the browser session.
2. A verified customer submits contact, order, purchase, requested amount, preferred method, antivirus, reason, and optional documents through a security-definer function.
3. PostgreSQL generates the reference and stores the customer-submitted purchase, amount, and method separately while authoritative payout fields remain pending.
4. A staff-only security-definer function records authoritative order details before review can begin.
5. Refund actions write status history and immutable audit metadata.
6. Database triggers queue email notifications.
7. Authenticated portal actions invoke the Resend processor.
8. Document requests call a server endpoint that checks ownership and creates a five-minute Storage link.

## Security model

- Service-role and Resend keys exist only in Vercel server environments.
- Customer and staff authorization is checked server-side with Supabase access tokens.
- Persistent rate limits are stored in an RLS-protected table callable only by the service role.
- Storage uploads are limited to owned or staff-accessible refund paths.
- Browser responses include CSP, HSTS, anti-framing, permissions, and content-sniffing protections.
- Sensitive API responses use `Cache-Control: no-store`.
- No raw beneficiary account number is stored.

## Realtime

Supabase Realtime refreshes refunds, histories, users, notes, documents, payments, notifications, and audit views. Realtime improves interface freshness but does not replace RLS.

## Reporting

Manager reporting filters the role-authorized in-memory refund dataset by search, status, and antivirus product. CSV cells are escaped and formula-prefixed values are neutralized before download. PDF generation uses dynamically imported `jsPDF` and `jspdf-autotable`, keeping the reporting engine out of the initial portal bundle. Every successful export records its format, filters, record count, total amount, actor, and timestamp in the audit log.

## Failure behavior

Email failures remain queued with retry metadata. Staff session restoration retries due messages. API errors are sanitized for users and written to Vercel logs. A React error boundary provides a controlled reload path after unexpected rendering failures.

## Banking integration boundary

The payment interface records manually processed external payments. `manual_bank_record` identifies records that were not transmitted by an API. A future integration must use an authorized banking API, secrets manager credentials, idempotency keys, webhook verification, retry handling, and immutable payment-event auditing.
