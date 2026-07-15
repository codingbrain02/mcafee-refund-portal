# Operational Monitoring

Monitoring uses the official Sentry React and Node SDKs. It is optional: the portal and APIs continue operating normally when Sentry variables are blank.

## Privacy Controls

The shared scrubber runs before frontend or server events are sent. It removes authorization headers, cookies, passwords, tokens, secrets, API keys, service-role values, emails, phone numbers, customer names, recipients, beneficiary and account fields, request and response bodies, IP addresses, signed URL parameters, JWT-shaped values, and circular or excessively deep data.

`sendDefaultPii` remains disabled. Do not enable Sentry Session Replay, request-body capture, local-variable capture, or default PII collection for this portal. Monitoring context should use operational labels such as route and operation, never customer or payment data.

## Runtime Setup

Create separate Sentry JavaScript projects or use one project with environment tags. Add these Vercel variables to Production and Preview:

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `VITE_SENTRY_DSN` | Public build value | Browser error ingestion endpoint |
| `SENTRY_DSN` | Server environment | Serverless error ingestion endpoint |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | Public build value | Browser performance sampling from 0 to 1; default 0 |
| `SENTRY_TRACES_SAMPLE_RATE` | Server environment | Server performance sampling from 0 to 1; default 0 |
| `VITE_APP_RELEASE` | Optional public build value | Explicit browser release name |
| `SENTRY_RELEASE` | Optional server value | Explicit server release name |

Vercel's commit SHA is used as the browser and server release fallback. Start both trace sample rates at `0`; error monitoring does not require performance tracing.

## Source Maps

Readable production stack traces require build-time source-map upload. Add `SENTRY_AUTH_TOKEN` as a Vercel secret, plus `SENTRY_ORG` and `SENTRY_PROJECT`. When all three exist, the Vite plugin creates hidden source maps, uploads them, and deletes local map artifacts after upload. The auth token must never use a `VITE_` prefix.

## Validation

1. Run `npm run check` with all Sentry variables blank and confirm monitoring stays disabled.
2. Add DSNs in a preview deployment and confirm `/api/health` reports monitoring as configured.
3. Trigger a controlled preview-only frontend and API exception.
4. Confirm the issue contains environment and release data but no email, token, phone, request body, signed URL, or banking details.
5. Confirm source-mapped stack frames identify repository files when build credentials are configured.

Do not trigger test exceptions in production after customer use begins. Use a preview deployment for monitoring acceptance tests.
