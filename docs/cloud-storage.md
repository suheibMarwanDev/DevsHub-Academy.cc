# Cloud file storage

Phase 4 moves certificate files and organization assets out of browser localStorage and into private Supabase Storage.

## Storage model

Bucket:

`devshub-assets`

The bucket is private.

Files are organized by organization:

```
organizations/<organization-id>/
  certificates/<serial>/<uuid>.pdf
  branding/<uuid>.<ext>
  templates/<name>-<uuid>.<ext>
```

The database stores only object paths. It does not permanently store signed URLs.

## Certificate PDFs

When a PDF is uploaded for a certificate:

1. The certificate is issued by the backend.
2. The PDF is uploaded to the private bucket.
3. Its object path is stored in `certificates.pdf_path`.
4. Public verification exposes an internal route:
   `/api/storage/certificate?serial=...`
5. The backend generates a short-lived signed Supabase URL only when the file is opened.

The storage path itself is not required by the public verifier.

## Organization logo

The current logo object path is stored in:

`organizations.logo_path`

Public logo delivery goes through:

`GET /api/storage/logo?slug=devshub-academy`

The bucket remains private; the API generates a temporary signed URL.

## Certificate templates

Template metadata is stored in:

`certificate_templates`

Supported operations:

- upload template
- list templates
- set one template active
- delete template
- open/download through a protected signed URL

Admin routes:

- `POST /api/storage/upload`
- `GET /api/storage/assets`
- `PATCH /api/storage/assets`
- `DELETE /api/storage/assets?id=...`
- `GET /api/storage/template?id=...`

## Allowed file types and limits

Certificate PDF:

- `application/pdf`
- maximum 2.5 MB

Logo:

- PNG
- JPEG
- WebP
- maximum 1.5 MB

Template:

- PDF
- PNG
- JPEG
- WebP
- maximum 2.5 MB

Files are checked by MIME type and magic bytes before upload.

These limits intentionally keep JSON/base64 uploads below typical serverless request limits. A later version can use signed direct uploads for much larger files.

## Required environment

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=devshub-assets
DEFAULT_ORGANIZATION_SLUG=devshub-academy
```

## Required migration

Apply:

`supabase/migrations/003_cloud_storage.sql`

It:

- adds `organizations.logo_path`
- adds `certificates.pdf_path`
- creates `certificate_templates`
- creates/configures the private `devshub-assets` bucket

## Demo mode

If Supabase is not configured:

- the marketing demo remains usable,
- certificate PDFs may stay local only for that browser,
- cloud branding/template tools show a clear configuration message,
- no cloud persistence is falsely reported.

When PostgreSQL + Supabase Storage are configured, the server becomes authoritative for files.
