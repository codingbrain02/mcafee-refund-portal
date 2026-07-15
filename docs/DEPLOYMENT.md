# Deployment Guide

## Prerequisites

- Supabase project
- Vercel project linked to the GitHub repository
- Resend account and API key
- Node.js 24 for local verification

## Supabase

1. Run `npx supabase login` and `npx supabase link`.
2. Add `SUPABASE_DB_PASSWORD` to local `.env` only.
3. Run `npm run db:push`.
4. In Supabase Auth URL Configuration, set the production site URL and password-reset redirects.
5. Keep email confirmation enabled.

Migrations configure private document storage, RLS, protected administration functions, notification triggers, signed-link authorization support, and API rate limiting.

## Vercel environment variables

Configure these for Production and Preview:

| Variable | Scope | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Public build | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Public build | Supabase anonymous key |
| `SUPABASE_URL` | Server | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server secret | Server-side RLS bypass for authorized functions |
| `RESEND_API_KEY` | Server secret | Email delivery |
| `RESEND_FROM_EMAIL` | Server | Verified sender or Resend test sender |
| `NOTIFICATION_CRON_SECRET` | Optional server secret | Future server-to-server processing |
| `CRON_SECRET` | Optional server secret | Compatibility fallback |
| `VITE_SENTRY_DSN` | Optional public build | Browser error monitoring |
| `SENTRY_DSN` | Optional server value | Serverless error monitoring |
| `SENTRY_AUTH_TOKEN` | Optional build secret | Sentry source-map upload |
| `SENTRY_ORG` | Optional build value | Sentry organization slug |
| `SENTRY_PROJECT` | Optional build value | Sentry project slug |

Do not add `SUPABASE_DB_PASSWORD` to Vercel. Leave banking variables unset until authorized credentials are received.

See `MONITORING.md` for privacy controls, trace sampling, release tags, and preview validation. Monitoring remains disabled when its DSNs are blank.

## Resend

`onboarding@resend.dev` is suitable for testing and normally sends only to the Resend account owner. Before customer rollout, verify a domain in Resend and change `RESEND_FROM_EMAIL` to an address on that domain.

## Release procedure

1. Run `npm run check`.
2. Apply pending Supabase migrations.
3. Push the reviewed commit to `main`.
4. Confirm GitHub Actions passes.
5. Confirm the Vercel production deployment is Ready.
6. Check `/api/health` and the production security headers.
7. Complete the smoke tests in `PRODUCTION_CHECKLIST.md`.

## Rollback

Use Vercel to promote the previous known-good deployment for frontend/API rollback. Database migrations are forward-only; prepare and review a corrective migration instead of editing migration history or resetting production data.
