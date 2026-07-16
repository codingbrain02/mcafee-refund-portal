# Administrator Manual

## Signing in

Use a verified portal account. Sessions persist across tabs through Supabase Auth. Password resets return to the production portal and require the user to choose a new password.

## User accounts

- Customer self-registrations and accounts created by authorized staff appear in User accounts and remain pending until the recipient verifies the email address.
- Unverified accounts remain pending and are eligible for removal after the configured verification window.
- The protected portal administrator cannot be deleted or demoted.
- Use role controls only for authorized staff changes.
- Account deletion requires typing the confirmation phrase shown by the portal.

Deleting an account removes associated operational records according to the database deletion functions. Audit history that must remain attributable stores actor details in immutable metadata.

## Refund operations

1. The customer creates and verifies an account, then submits the order number, antivirus, reason, and optional documents.
2. Open Manager and select the Submitted request.
3. In Order verification, record the verified purchase date, refundable amount, and refund method.
4. Start review after verification unlocks the workflow button.
5. Enter a note and request documents when necessary.
6. Verify documents after reviewing the signed document links.
7. Approve or reject. Rejection requires a reason.
8. Approved refunds move to Bank for manual payment tracking.

Workflow buttons lock after an action is recorded or when a later step makes an earlier action invalid.

## Documents

Documents are private. The Open button requests a link that expires after five minutes. Do not forward or store signed links. Opening a document creates an audit event.

## Email notifications

The portal queues and dispatches emails for submission, document requests, approval, rejection, and credited payment. The Bank view shows delivery state, attempt count, provider reference, and errors.

## Reports and audit

Use the manager search, status filter, and antivirus filter to define the visible report dataset. The summary shows the visible record count, total requested amount, average request, and credited count. Choose CSV for spreadsheet analysis or PDF for a formatted operational report. Export remains disabled when no records match.

Each export creates an audit event containing the format, active filters, record count, total amount, actor, and timestamp. Audit events also cover status changes, document access, notifications, user management, and payment workflow activity.

## Banking limitation

The Bank view is an internal manual-reconciliation interface. Complete the actual payment through the organization's authorized external bank process, then record the reference and last four account digits. Mark Settled only after independent confirmation. The portal does not submit funds to Bank of America.

## Role boundaries

- Refund Managers verify customer-submitted order details, review requests, create reports, and reconcile payments. They cannot manage login accounts or roles.
- Administrators perform manager work, create Customer and Refund Manager accounts, view customers, and inspect permitted audit events. They cannot change roles or delete accounts.
- The Portal Administrator can create every role, change roles, and delete non-protected accounts. The protected head account cannot be viewed by ordinary staff, demoted, or deleted.
