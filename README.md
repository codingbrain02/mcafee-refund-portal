# Refund Management Portal

Secure web portal for customer refund intake, staff review, document verification, payment tracking, audit history, and email notifications.

## Current architecture

- React 19, TypeScript, and Vite frontend
- Supabase Auth, PostgreSQL, Realtime, Row Level Security, and private Storage
- Vercel serverless functions for Resend delivery and signed document links
- Filtered CSV and on-demand PDF operational reporting
- Optional privacy-scrubbed Sentry monitoring for frontend and serverless failures
- Vercel production hosting with GitHub-based deployment
- Database migrations under `supabase/migrations`

The banking screen currently records internal payment workflow data. It does not call Bank of America or any other banking service until authorized API credentials and documentation are supplied.

## Roles

- Customer: submits and tracks owned refunds, uploads documents, and opens authorized document links.
- Refund manager: reviews requests, verifies documents, approves or rejects refunds, requests additional documents, and manages payment workflow.
- Administrator: performs manager operations plus user, audit, reporting, and configuration oversight.
- Portal administrator: the protected head administrator account configured by the database policies.

## Local setup

1. Install Node.js 24 and run `npm install`.
2. Copy `.env.example` to `.env` and enter the Supabase values.
3. Link the Supabase project with `npx supabase link`.
4. Apply migrations with `npm run db:push`.
5. Run `npm run dev` when local development is needed.

Do not commit `.env`, service-role keys, database passwords, Resend keys, or banking credentials.

## Quality checks

```bash
npm run check
npm run uat:production
```

`uat:production` runs a self-cleaning acceptance test against the configured Supabase project. See `docs/UAT.md` before running it.

This runs linting, automated tests, TypeScript compilation, and the production Vite build. GitHub Actions runs the same checks for pushes and pull requests.

## Documentation

- [API documentation](docs/API.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Administrator manual](docs/ADMIN_MANUAL.md)
- [Technical architecture](docs/TECHNICAL.md)
- [Production checklist](docs/PRODUCTION_CHECKLIST.md)
- [Monitoring guide](docs/MONITORING.md)

## Production

The production application is hosted at `https://mcafee-refund-portal.vercel.app`. The health endpoint is available at `/api/health`.
