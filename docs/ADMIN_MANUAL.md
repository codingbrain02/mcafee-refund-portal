# Administrator Manual

## Signing in

Use a verified portal account. Sessions persist across tabs through Supabase Auth. Password resets return to the production portal and require the user to choose a new password.

## User accounts

- New verified signups appear in User accounts.
- Unverified accounts remain pending and are eligible for removal after the configured verification window.
- The protected portal administrator cannot be deleted or demoted.
- Use role controls only for authorized staff changes.
- Account deletion requires typing the confirmation phrase shown by the portal.

Deleting an account removes associated operational records according to the database deletion functions. Audit history that must remain attributable stores actor details in immutable metadata.

## Refund operations

1. Open Manager and select a refund.
2. Start review.
3. Enter a note and request documents when necessary.
4. Verify documents after reviewing the signed document links.
5. Approve or reject. Rejection requires a reason.
6. Approved refunds move to Bank for internal payment tracking.

Workflow buttons lock after an action is recorded or when a later step makes an earlier action invalid.

## Documents

Documents are private. The Open button requests a link that expires after five minutes. Do not forward or store signed links. Opening a document creates an audit event.

## Email notifications

The portal queues and dispatches emails for submission, document requests, approval, rejection, and credited payment. The Bank view shows delivery state, attempt count, provider reference, and errors.

## Reports and audit

Use the manager search, status filter, and antivirus filter to define the visible report dataset. The summary shows the visible record count, total requested amount, average request, and credited count. Choose CSV for spreadsheet analysis or PDF for a formatted operational report. Export remains disabled when no records match.

Each export creates an audit event containing the format, active filters, record count, total amount, actor, and timestamp. Audit events also cover status changes, document access, notifications, user management, and payment workflow activity.

## Banking limitation

The Bank view is an internal workflow interface. Do not represent it as a Bank of America system and do not enter full bank account numbers. Only token/reference data and the last four account digits may be recorded. External payment submission remains disabled until an authorized API is integrated.
