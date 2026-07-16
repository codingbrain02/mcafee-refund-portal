# Refund Management Portal

A secure, role-based refund operations portal for verified customer orders, supporting-document review, ordered approvals, manual payment reconciliation, customer email notifications, reporting, and immutable audit history.

The application is designed to operate without an order-system or banking API. Customers submit their order number, antivirus product, reason, and optional documents directly. Authorized staff verify the purchase date, refundable amount, and refund method before review can begin. The Bank of America-styled payment workspace records payments completed outside the portal; it does not transmit money or connect to Bank of America.

## Production status

- Application: `https://mcafee-refund-portal.vercel.app`
- Health check: `https://mcafee-refund-portal.vercel.app/api/health`
- Deployment: Vercel from GitHub `main`
- Database and authentication: Supabase
- Email delivery: Resend
- Banking mode: manual reconciliation only
- External order API: not required
- Banking API: not required for manual operation

## Technology

- React 19, TypeScript, and Vite
- Supabase Auth, PostgreSQL, Row Level Security, Realtime, and private Storage
- Vercel serverless functions
- Resend transactional email
- `jsPDF` and `jspdf-autotable` for PDF receipts and reports
- Node.js automated tests and GitHub Actions CI

## Application areas

### Dedicated login

The `/login` route supports customer self-registration and all customer and staff sign-ins. Self-registration always creates a Customer account and requires Supabase email verification. Staff accounts and staff roles remain restricted to authorized administrators.

Authentication supports:

- Email and password sign-in
- Customer self-registration with full name, email, and password
- Persistent sessions across browser tabs
- Email verification
- Password recovery
- Optional TOTP authenticator two-factor authentication
- A second-factor challenge during sign-in when TOTP is enabled
- Professional sign-out confirmation

### Customer workspace

A verified customer can:

- Enter the order number and select the antivirus shown on the purchase confirmation.
- Submit the request immediately without waiting for staff to create an order record.
- See the amount and refund method as Pending verification until staff confirms them.
- Select a refund reason.
- Optionally attach PDF, JPG, or PNG documents up to 10 MB each.
- Preview image attachments and remove files before submission.
- Review the complete request before submission.
- Submit one refund request per order number.
- Track Submitted, Under Review, Approved, and Refunded milestones with timestamps.
- See an estimated resolution date.
- Open authorized supporting documents through five-minute signed links.
- Download a PDF submission receipt.
- Cancel and permanently delete an owned request while it remains Submitted.
- Receive automatic realtime updates without manually refreshing.

Customers cannot:

- Enter or change the refundable amount.
- Enter a refund amount, purchase date, or payout method.
- Create their own refund reference number.
- Submit an order belonging to another email address.
- Submit a second refund for the same order.
- Access staff notes, other customers, audit logs, or payment controls.
- Mark a refund approved, paid, settled, or credited.

Government ID is not collected by the standard customer form. Supporting documents are optional unless staff request specific evidence during review.

### Refund Manager

The Refund Manager is an operational staff role with access to the Manager and Bank views.

Refund Managers can:

- Verify the purchase date, refundable amount, and refund method for customer-submitted requests.
- Start review only after the order details have been verified.
- View customer refund requests and supporting documents.
- Create a refund request on behalf of a customer when an exception requires staff intake.
- Search requests by customer, reference, order, product, or status.
- Filter reports by status and antivirus product.
- Start review and become the request handler.
- Add internal notes.
- Request additional documents by email.
- Verify documents.
- Approve or reject a request in the enforced sequence.
- Enter a required rejection reason.
- Export the visible request set to CSV or PDF.
- Create a manual payment record after approval.
- Record a beneficiary name hash, destination-account last four digits, and transaction reference.
- Update a manual payment to Queued, Submitted, Settled, or Failed.
- Marking a payment Settled moves the refund to Credited and queues the credited email.
- View payment and email-delivery records.

Refund Managers cannot:

- Open the Administrator dashboard.
- Change user roles.
- Delete user accounts.
- Create customer or staff login accounts.
- View or modify the protected Portal Administrator account.
- Reassign a request already handled by another staff member.
- Skip, repeat, or reverse refund workflow steps.
- Transmit funds to Bank of America from the portal.

### Administrator

The Administrator is a broader operations and oversight role. It includes the Customer Operations, Manager, Admin, and Bank views.

Administrators can perform every Refund Manager operation and can additionally:

- View all customer requests from Customer Operations.
- Take over or reassign a handled refund while performing an allowed status transition.
- Create Customer accounts.
- Create Refund Manager accounts.
- View verified and pending user accounts except the protected Portal Administrator.
- View registered customer accounts.
- View recent immutable audit events except events protected by Portal Administrator privacy policies.
- View operational metrics for users, customers, pending verification, and audits.

Administrators cannot:

- Create another Administrator account.
- Change account roles.
- Delete user accounts.
- View the protected Portal Administrator account or its protected audit activity.
- Demote, alter, or delete the Portal Administrator.
- Skip or repeat workflow transitions.
- Represent a manual payment record as an API-transmitted bank payment.

When an Administrator needs a new Administrator account, they must contact the Portal Administrator.

### Portal Administrator

The Portal Administrator is the protected head account identified by `jccodingbrain@gmail.com`.

The Portal Administrator can:

- Perform all Administrator and Refund Manager operations.
- Create Customer, Refund Manager, and Administrator accounts.
- Change user roles.
- Delete non-protected user accounts after entering `Delete user account` exactly.
- View the complete permitted user-management and audit context.
- Maintain final authority over portal access.

Portal Administrator protections:

- The account is forced to the Administrator role by database triggers.
- Its name, role, verification state, and protected status cannot be changed through ordinary account controls.
- It cannot be demoted or deleted.
- It cannot delete its own active session.
- Ordinary Administrators and Refund Managers cannot select or view it.
- Ordinary Administrator audit queries exclude protected Portal Administrator activity.

## Direct customer-request workflow

1. The customer creates an account, verifies the email, and signs in at `/login`.
2. The customer enters the order number and selects the antivirus product.
3. The customer selects a reason, adds optional documents, reviews, and submits.
4. PostgreSQL generates the refund reference and creates a Submitted request atomically.
5. The amount and refund method remain Pending staff verification.
6. A Refund Manager selects the request and records the verified purchase date, amount, and method.
7. Start review remains disabled until those authoritative details are recorded.
8. The request then follows the ordered review, document verification, approval, payment, and completion workflow.
9. The customer may cancel and permanently delete the request while it remains Submitted.

Submission controls include verified-email enforcement, one request per customer and order number, staff-only refund amounts, and a maximum of five submissions per account per hour.

## Refund workflow

The database enforces this sequence:

```text
Submitted
  -> Under Review
  -> Documents Verified
  -> Approved
  -> Payment Processing
  -> Credited
```

Alternative terminal path:

```text
Under Review or Documents Verified -> Rejected
```

Rules:

- Starting review assigns the active employee as handler.
- A Refund Manager cannot process a request assigned to another handler.
- Only an Administrator can reassign an already handled request.
- A transition cannot be repeated.
- Earlier buttons lock after a later stage is reached.
- Skipping a stage is rejected by PostgreSQL even if a browser control is modified.
- Rejection requires an internal reason.
- Every transition records the employee, timestamp, previous status, next status, and note.

## Manual Bank of America payment workspace

The Bank view is an internal payment-reconciliation workspace with Bank of America visual styling. It is not a Bank of America website, is not affiliated with Bank of America, and does not call Bank of America services.

Manual procedure:

1. Complete the payment using the organization's authorized external bank process.
2. Select an Approved refund in the portal.
3. Enter the beneficiary name, only the destination account's last four digits, and the external transaction reference.
4. Create the internal payment record.
5. The refund moves to Payment Processing.
6. After staff independently confirms settlement, select Settled and update the status manually.
7. The refund moves to Credited and the customer credited email is queued.

Never enter online-banking passwords, card numbers, security codes, full account numbers, or API credentials into the portal.

## Files and documents

- Accepted formats: PDF, JPG, and PNG
- Maximum size: 10 MB per file
- Storage bucket: private `refund-documents`
- Object paths are scoped to the refund UUID.
- Access requires ownership or an authorized staff role.
- Downloads use signed links that expire after five minutes.
- Signed links are never stored by the client.
- Every generated link creates an audit event.

## Email notifications

Resend delivers queued email for:

- Refund submitted
- Additional documents requested
- Refund approved
- Refund rejected
- Refund credited

Delivery records contain status, attempt count, next attempt, provider reference, sent timestamp, and sanitized error information. Failed messages remain queued for later authenticated processing. SMS and cron scheduling are not used.

## Realtime behavior

Supabase Realtime refreshes:

- Refund requests
- Status history
- Supporting documents
- Internal notes
- User accounts
- Payments
- Notifications
- Audit events

Realtime improves interface freshness but never replaces database authorization.

## Data deletion

### Customer cancellation

An owned request may be cancelled only while Submitted and only after typing `Cancel refund request` exactly. Cancellation removes the refund, documents, stored files, history, notes, notifications, payment records, request-specific audit data, and orphaned customer record. A generic cancellation audit event remains without the deleted customer details.

### User deletion

Only the Portal Administrator can delete an account. Deletion removes the authentication account and owned operational records. Customer refunds linked to the deleted account are removed. Staff-authored notes/history are cleaned, and requests handled by deleted staff are unassigned where appropriate. Protected audit metadata remains only where required by the immutable audit design.

### Unverified accounts

Unverified accounts are marked Pending Verification and are eligible for cleanup after five days. The protected Portal Administrator is excluded from cleanup.

## Audit logging

Audit events include actor identity, target, action, metadata, and timestamp for:

- Account creation, role changes, and deletion
- Eligible-order creation and status changes
- Refund submission and cancellation
- Workflow transitions
- Internal notes and document requests
- Signed document access
- Report exports and active filters
- Payment status changes
- Notification queueing and delivery
- Optional two-factor changes

Audit records cannot be updated or deleted by browser roles.

## Security controls

- Supabase email verification and session management
- Optional TOTP authenticator 2FA
- PostgreSQL Row Level Security
- Security-definer functions with explicit grants
- Database-enforced workflow transitions
- Server-side service-role isolation
- Submission and server-endpoint rate limiting
- Private object storage and short-lived signed links
- File MIME and size constraints
- CSV formula-injection protection
- Password reset redirect validation
- Content Security Policy
- HSTS, anti-framing, content-type, referrer, and permissions headers
- Sanitized API error responses
- No full beneficiary account number storage
- Protected head-administrator policies

## Environment variables

Copy `.env.example` to `.env` for local work. Never commit real values.

| Variable | Location | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Browser/Vercel | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Browser/Vercel | Public Supabase anonymous key |
| `SUPABASE_URL` | Vercel server | Supabase project URL for server functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel secret | Server-only administrative operations |
| `SUPABASE_DB_PASSWORD` | Local only | Applying database migrations |
| `RESEND_API_KEY` | Vercel secret | Transactional email delivery |
| `RESEND_FROM_EMAIL` | Vercel server | Verified email sender |
| `NOTIFICATION_CRON_SECRET` | Optional | Server-to-server notification authorization |
| `CRON_SECRET` | Optional | Compatibility fallback; cron is not required |

Banking environment variables remain blank in manual mode.

## Local setup

1. Install Node.js 24.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and add the Supabase browser values.
4. Add `SUPABASE_DB_PASSWORD` locally.
5. Authenticate with `npx supabase login`.
6. Link the project with `npx supabase link`.
7. Apply migrations with `npm run db:push`.
8. Run `npm run check` before deployment.

Use `npm run dev` only when interactive local development is intentionally required.

## Commands

```bash
npm run lint
npm test
npm run build
npm run check
npm run db:push
npm run uat:production
```

`npm run check` runs lint, automated tests, TypeScript compilation, and the production build. `npm run uat:production` runs a self-cleaning live Supabase acceptance test; read `docs/UAT.md` first.

## Deployment

1. Run `npm run check`.
2. Apply pending Supabase migrations with `npm run db:push`.
3. Commit only reviewed project files.
4. Push to `main`.
5. Confirm GitHub Actions passes.
6. Confirm the Vercel deployment is Ready.
7. Check `/api/health`.
8. Test customer, manager, administrator, Portal Administrator, email, document, and manual payment workflows.

## Documentation

- [API documentation](docs/API.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Administrator manual](docs/ADMIN_MANUAL.md)
- [Technical architecture](docs/TECHNICAL.md)
- [Production checklist](docs/PRODUCTION_CHECKLIST.md)
- [Production UAT](docs/UAT.md)
- [External setup and deferred optional integrations](docs/PENDING_WORK.md)

## Remaining external setup

The application is complete for manual operation. Production ownership still requires:

- Purchasing and connecting the final domain
- Adding that domain to Supabase authentication URLs
- Verifying the production email domain in Resend
- Replacing the Resend test sender
- Completing final browser acceptance testing with real authorized accounts

An order API or Bank of America API is optional future work and is not required for the documented manual workflow.
