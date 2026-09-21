# DevsHub Academy Credential Platform

A polished certificate-verification demo designed to show both the **Verifier** and **Admin** experiences to prospective customers in one interface.

## Current product mode

The project intentionally keeps **Verifier** and **Admin** visible together. This is a marketing/demo decision so a customer can understand the full workflow before authentication is added later.

Do not hide either experience until the sales/demo phase is complete.

## Structure

```
.
├── index.html              # Source HTML shell
├── assets/
│   ├── styles.css          # Complete UI styles
│   └── app.js              # Frontend behavior
├── api/
│   ├── certificates.js     # Certificate API
│   ├── health.js           # Deployment/config health endpoint
│   ├── auth/               # Login/session/logout endpoints
│   ├── storage/            # Private PDF/logo/template delivery
│   └── lib/
│       ├── certificates.js # Validation + demo-mode policy
│       └── storage.js      # Redis/KV storage adapter
├── scripts/
│   ├── build.mjs           # Rebuilds dist/
│   └── check.mjs           # Lightweight structural checks
├── dist/                   # Static deployment output
├── .env.example
└── package.json
```

## Development

No frontend framework or dependency install is required for the current UI.

```bash
npm run check
npm run build:static
```

The `build:static` command recreates `dist/` from the source HTML/assets without changing Vercel's existing deployment behavior.

## Certificate storage

Without cloud environment variables, the public demo continues to work using the frontend fallback and the built-in sample credential.

For cross-device persistence configure:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

The backend stores certificates in a Redis hash, one record per serial, rather than rewriting one large JSON array.

## Demo vs production security

`DEMO_MODE=true` intentionally keeps certificate issuing open enough for the sales demonstration.

Before a real customer launch:

1. Set `DEMO_MODE=false`.
2. Add real admin authentication/sessions.
3. Protect Admin routes and API write operations.
4. Move certificate PDFs to object storage.
5. Add organization/user roles and audit logs.

The current visual Admin/Verifier layout should remain unchanged during the marketing phase unless explicitly requested.


## Private file storage

Certificate PDFs, organization logos, and certificate templates are designed for private Supabase Storage.

Apply `supabase/migrations/003_cloud_storage.sql` and configure:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET=devshub-assets`

The database stores object paths while the backend issues temporary signed URLs when files are opened.

See `docs/cloud-storage.md` for the full storage design.
