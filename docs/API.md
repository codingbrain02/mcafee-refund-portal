# API Documentation

The frontend uses Supabase Auth and Row Level Security for refund data. Custom Vercel endpoints handle operations that require server-only credentials.

## Authentication

Protected endpoints expect a Supabase access token:

```http
Authorization: Bearer <supabase-access-token>
Content-Type: application/json
```

Access tokens must never be logged or stored outside the Supabase session client.

## GET /api/health

Returns service readiness without customer data or secret values.

Successful response:

```json
{
  "status": "healthy",
  "checkedAt": "2026-07-15T02:00:00.000Z",
  "components": {
    "database": "available",
    "email": "configured"
  }
}
```

Status codes: `200` healthy or non-critical degradation, `405` unsupported method, `503` unavailable database/configuration.

## POST /api/process-notifications

Processes due queued email notifications. Managers and administrators may process the operational queue. Customers may process only notifications belonging to a refund they own.

Request:

```json
{
  "refundRequestId": "uuid"
}
```

The refund ID is required for customer calls and optional for staff calls. A configured server secret may also authorize server-to-server processing.

Status codes: `200`, `401`, `403`, `405`, `429`, `500`, `503`.

## POST /api/document-link

Creates a private, five-minute Supabase Storage link after checking document ownership or staff role.

Request:

```json
{
  "documentId": "uuid"
}
```

Successful response:

```json
{
  "expiresIn": 300,
  "url": "https://...signed-storage-url..."
}
```

The URL must not be persisted. Every generated link is recorded in the immutable portal audit log.

Status codes: `200`, `400`, `401`, `403`, `404`, `405`, `429`, `500`, `503`.

## Supabase operations

Refund CRUD, status history, internal notes, users, notifications, and payment records use Supabase's generated REST API. Authorization is enforced by the policies and security-definer functions in `supabase/migrations` rather than a separate Express API.
