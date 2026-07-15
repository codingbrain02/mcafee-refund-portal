# Pending Work

The application code is ready for the items below, but they require external services, credentials, or business approval before they can be completed safely.

## External Setup - Pending

- Purchase and connect the production domain in Vercel.
- Set the production domain as the Supabase Site URL and allow it in authentication redirect URLs.
- Verify a sending domain in Resend and replace the temporary sender address.
- Confirm production email delivery for account verification, password reset, refund submission, document requests, approval, rejection, and credited status.
- Complete final browser acceptance checks with real customer, manager, and administrator accounts.
- Complete document upload acceptance checks using valid PDF, JPG, and PNG samples below 10 MB.

## Deferred Banking - Pending

- Obtain Bank of America's authorized API documentation, sandbox access, client credentials, and written approval for the intended payment workflow.
- Confirm the approved branding and interface rules. The portal must not imitate Bank of America or call undocumented endpoints.
- Implement server-only beneficiary validation and payment submission through the authorized API.
- Add idempotency controls, signed webhook verification, retry handling, reconciliation, and confirmation receipts.
- Store only transaction references and masked beneficiary details; never store raw bank credentials or full account numbers.
- Run sandbox and production banking acceptance tests before enabling payment controls.

Until these requirements are supplied, banking controls must remain disabled and no transaction should be represented as submitted to Bank of America.
