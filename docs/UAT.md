# Production User Acceptance Testing

The production UAT harness validates the live Supabase authorization and workflow behavior without using or modifying real portal accounts.

## Coverage

- Confirmed customer, refund manager, and administrator authentication
- Staff creation of an eligible manual order
- Customer-only visibility by verified order email
- Server-locked refund amount and generated reference
- Duplicate eligible-order submission rejection
- Customer refund submission and own-record visibility
- Customer denial from staff-only status and audit operations
- Manager visibility of refund operations
- Rejection of skipped and repeated workflow transitions
- Ordered review, document verification, and approval transitions
- Customer receipt of a live PostgreSQL realtime update
- Manager and non-head administrator denial from user-role management
- Removal of temporary refunds, related records, and authentication accounts

Bank payment submission is excluded until authorized banking credentials and a sandbox endpoint are provided.

## Run

The local `.env` must contain the linked project URL, anon key, and service-role key. Then run:

```powershell
npm run uat:production
```

The command deliberately includes a production confirmation flag in its package script. It creates uniquely named accounts under the reserved `example.invalid` domain, does not dispatch queued emails, and uses a `finally` cleanup block. A successful run ends with both `UAT PASSED` and `Temporary UAT records removed`.

## Release Evidence

Record the date, commit, Supabase migration version, test output, deployment URL, and reviewer in the production checklist. Do not include passwords, access tokens, service-role keys, or customer data in release evidence.
