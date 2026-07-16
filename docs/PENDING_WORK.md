# Pending Work

The application code is ready for the items below, but they require external services, credentials, or business approval before they can be completed safely.

## External Setup - Pending

- Purchase and connect the production domain in Vercel.
- Set the production domain as the Supabase Site URL and allow it in authentication redirect URLs.
- Verify a sending domain in Resend and replace the temporary sender address.
- Confirm production email delivery for account verification, password reset, refund submission, document requests, approval, rejection, and credited status.
- Complete final browser acceptance checks with real customer, manager, and administrator accounts.
- Complete document upload acceptance checks using valid PDF, JPG, and PNG samples below 10 MB.

## Optional Future Integrations - Deferred

- An order API is not required. Authorized staff maintain the eligible-order ledger manually.
- A Bank of America API is not required. Authorized staff record externally processed payments and settlement manually.
- Future automated banking would require official documentation, sandbox access, client credentials, written approval, idempotency, signed webhooks, reconciliation, and production acceptance tests.
- Future automated order lookup would require an authorized order-system contract and server-side validation.

No manual portal record may be represented as an API-transmitted Bank of America payment.
