# Production Checklist

Items that depend on external accounts, approvals, or authorized banking credentials are tracked in [Pending Work](PENDING_WORK.md).

## User Acceptance Testing

- Run `npm run uat:production` against the linked production Supabase project.
- Confirm customer, manager, administrator, workflow, RLS, and realtime checks pass.
- Confirm the command reports that temporary UAT records were removed.
- Record the result using the procedure in `docs/UAT.md`.
- Repeat banking UAT after authorized sandbox credentials are available.

## Automated

- [ ] `npm run check` passes.
- [ ] GitHub Actions CI passes on `main`.
- [ ] Supabase reports no pending migrations.
- [ ] Vercel deployment is Ready.
- [ ] `/api/health` returns `healthy`.

## Authentication and roles

- [ ] New customer email verification succeeds.
- [ ] Session persists across a second tab.
- [ ] Password reset returns to the production domain.
- [ ] Customer cannot open Manager, Admin, or Bank views.
- [ ] Manager cannot perform protected portal-administrator actions.
- [ ] Head administrator cannot be deleted or demoted.

## Refund workflow

- [ ] Staff can add an eligible order manually.
- [ ] Customer sees only orders matching the verified account email.
- [ ] Customer cannot edit product, date, refund method, amount, or reference.
- [ ] A duplicate refund for the same eligible order is rejected.
- [ ] Submission rate limiting is enforced.
- [ ] Customer can submit and cancel an eligible request.
- [ ] Staff can submit on behalf of a customer.
- [ ] Review actions lock in the correct order.
- [ ] Rejection requires and records a reason.
- [ ] Realtime updates appear across two sessions.

## Documents and email

- [ ] PDF, JPG, and PNG upload succeeds below 10 MB.
- [ ] Unsupported or oversized upload is rejected.
- [ ] Owner and staff can open a five-minute signed link.
- [ ] An unrelated customer cannot open the document.
- [ ] Submitted, document-requested, approved, rejected, and credited emails send.
- [ ] Resend sender domain is verified before broad customer delivery.

## Operations

- [ ] Export is disabled with no filtered records.
- [ ] CSV and PDF exports match the visible search, status, and antivirus filters.
- [ ] Export audit events record format, filters, count, total, actor, and timestamp.
- [ ] Audit events identify actor, action, target, and timestamp.
- [ ] Vercel logs contain no access tokens, service keys, or full bank details.
- [ ] Manual payment records are clearly identified as non-API transactions.
- [ ] Settled is recorded only after external payment confirmation.
