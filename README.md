# DevsHub Academy Credential Platform

A production-oriented certificate verification and credential management platform with a public verifier and a multi-tenant administration console.

## Product modes

### Demo mode

`DEMO_MODE=true`

- Verifier and Admin stay visible and accessible together.
- Useful for customer demonstrations and sales presentations.
- Browser fallback keeps the demo usable even before Supabase is configured.

### Production mode

`DEMO_MODE=false`

- Public verification stays open.
- Admin requires Supabase Auth.
- Organization membership and role checks are enforced server-side.
- Database, private file storage, audit logs, analytics, rate limits, and RLS become the authoritative system.

## Main capabilities

- Public certificate verification by serial, QR, or direct link
- Official downloadable QR per certificate
- Server-generated unique certificate serials
- Valid / revoked / expired certificate lifecycle
- CSV / Excel bulk issuance
- Private certificate PDF storage
- Organization logos and certificate templates
- Dashboard analytics and verification reports
- Multi-organization memberships and organization switching
- Per-organization display name, colors, logo, and custom verification domain
- HttpOnly cookie authentication
- Role-based access: owner, admin, issuer, viewer
- Audit logs
- Rate limiting for public verification and login attempts
- Supabase RLS policies
- CI tests, scheduled smoke monitoring, and scheduled backup export

## Structure

```
.
├── index.html
├── assets/
│   ├── styles.css
│   └── app.js
├── api/
│   ├── certificates.js
│   ├── health.js
│   ├── auth/
│   └── storage/
├── server/
│   ├── auth.js
│   ├── certificates.js
│   ├── database.js
│   ├── file-storage.js
│   ├── security.js
│   └── storage.js
├── supabase/
│   └── migrations/
├── scripts/
│   ├── build.mjs
│   ├── check.mjs
│   ├── smoke.mjs
│   └── export-backup.mjs
├── tests/
├── .github/workflows/
├── dist/
├── vercel.json
├── .env.example
└── package.json
```

## Local checks

```bash
npm run check
npm test
npm run ci
npm run build:static
```

No frontend framework build is required. `build:static` recreates `dist/` from the source HTML/assets.

## Supabase production setup

Apply migrations in order:

1. `001_initial_schema.sql`
2. `002_auth_membership.sql`
3. `003_cloud_storage.sql`
4. `004_product_foundation.sql`
5. `005_security_rls.sql`

Required Vercel environment variables:

```
DEMO_MODE=false
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=devshub-assets
DEFAULT_ORGANIZATION_SLUG=devshub-academy
RATE_LIMIT_SALT=
```

Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only.

## Monitoring

`GET /api/health` reports application readiness plus the deployment release identifier.

GitHub Actions also runs:

- CI on pushes and pull requests
- production smoke tests every 6 hours
- Supabase JSON backup export daily

## Documentation

- `docs/database.md`
- `docs/authentication.md`
- `docs/certificates-api.md`
- `docs/cloud-storage.md`
- `docs/production.md`
