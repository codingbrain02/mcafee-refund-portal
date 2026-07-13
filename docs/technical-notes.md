# Refund Management Portal Technical Notes

## Supabase backend

- Apply `supabase/schema.sql` to a Supabase project.
- Use Supabase Auth for username/password, refresh tokens, MFA enrollment, password reset, and session timeout configuration.
- Store refund documents in a private Supabase Storage bucket or S3/Azure Blob if required by deployment policy.
- Generate time-limited document links from server-side code only.

## Authorized banking integration

Banking credentials must stay server-side in environment variables or a secrets manager. The frontend should call an internal payment endpoint only after manager approval and MFA confirmation. That endpoint should validate beneficiary information, call the organization's authorized banking API, retry transient errors, and write payment events to `payment_transactions` and `audit_logs`.

## Security checklist

- Enable TLS 1.3 at the reverse proxy.
- Enforce Supabase RLS on all tables.
- Use rate limiting on auth, upload, export, and payment routes.
- Validate PDF, JPG, and PNG uploads and reject files larger than 10 MB.
- Keep audit logs append-only at the application layer.
- Export reports only for authorized roles.
