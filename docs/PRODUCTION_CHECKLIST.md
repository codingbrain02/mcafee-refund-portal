# Production Checklist

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
- [ ] Audit events identify actor, action, target, and timestamp.
- [ ] Vercel logs contain no access tokens, service keys, or full bank details.
- [ ] Banking API controls remain disabled until authorized credentials are supplied.
