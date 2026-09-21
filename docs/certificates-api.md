# Certificates API

Phase 3 makes the backend authoritative for certificate lifecycle operations.

## Public verification

`GET /api/certificates?serial=DVH-2026-123456&source=serial`

Supported verification sources:

- `serial`
- `qr`
- `direct_link`

The public response returns one certificate only. Verification events are recorded in PostgreSQL when the database is active.

## Admin list / search

Requires an authenticated admin session when `DEMO_MODE=false`.

`GET /api/certificates?q=ahmed&status=valid&limit=100`

Supported status filters:

- `valid`
- `revoked`
- `expired`

## Issue certificate

`POST /api/certificates`

Example body:

```json
{
  "name": "Ahmed Ali",
  "course": "Web Development Essentials",
  "prefix": "DVH",
  "date": "2026-09-21",
  "expiresAt": null,
  "status": "valid"
}
```

The client does **not** choose the final certificate serial. The server generates a serial such as:

`DVH-2026-483921`

PostgreSQL also enforces a unique constraint on `certificates.serial`.

## Update / revoke / restore

`PATCH /api/certificates?serial=DVH-2026-483921`

Examples:

Update holder/course:

```json
{
  "name": "Ahmed Ali",
  "course": "Advanced Web Development"
}
```

Revoke:

```json
{
  "status": "revoked",
  "revokedReason": "Certificate replaced"
}
```

Restore:

```json
{
  "status": "valid"
}
```

Expire:

```json
{
  "status": "expired"
}
```

Records are not hard-deleted by this API. Revocation preserves traceability and audit history.

## Authorization

Public:

- single-certificate verification

Authenticated admin:

- certificate listing/search

Write roles:

- `owner`
- `admin`
- `issuer`

Read-only admin role:

- `viewer`

## Auditability

When PostgreSQL is configured, issue/update/revoke/restore actions are written to `audit_logs`.

Verification events are written to `verification_logs`.

## Demo behavior

If no cloud storage is configured and `DEMO_MODE=true`:

- the API still generates server-side serials,
- the browser can keep demo certificates locally,
- PATCH operations return the updated fields without pretending they were persisted.

Once PostgreSQL is configured, the database becomes authoritative and local browser records are no longer trusted as the official source.
