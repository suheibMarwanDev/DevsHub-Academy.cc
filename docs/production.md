# Production activation guide

The codebase supports both customer-facing Demo Mode and authenticated Production Mode.

## 1. Create / connect Supabase

Configure:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET=devshub-assets`
- `DEFAULT_ORGANIZATION_SLUG=devshub-academy`

The service-role key must only exist in server-side environment variables.

## 2. Apply database migrations

Apply these SQL files in order:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_auth_membership.sql`
3. `supabase/migrations/003_cloud_storage.sql`
4. `supabase/migrations/004_product_foundation.sql`
5. `supabase/migrations/005_security_rls.sql`

They create the database model, authentication foreign keys, private storage bucket, analytics functions, rate-limit storage, multi-tenant branding, and RLS policies.

## 3. Create the first owner

Create a user in Supabase Authentication, then link that user to the organization:

```sql
insert into public.organization_members (
  organization_id,
  user_id,
  role
)
select
  id,
  'USER_UUID_HERE'::uuid,
  'owner'
from public.organizations
where slug = 'devshub-academy';
```

## 4. Configure security

Set:

```
RATE_LIMIT_SALT=<long-random-secret>
```

The server HMACs client IP addresses before storing rate-limit keys. Raw IP addresses are not stored by the rate-limit subsystem.

Static security headers are defined in `vercel.json`.

## 5. Keep Demo Mode for sales or enable Production

Sales / demonstration:

```
DEMO_MODE=true
```

Real authenticated deployment:

```
DEMO_MODE=false
```

Production mode protects certificate listing, issuance, updates, templates, branding, and reports.

## 6. Configure GitHub Actions

For scheduled backups add repository secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Backups are exported as GitHub Action artifacts and retained for 14 days.

Optionally set repository variable:

- `SITE_URL`

If it is not set, the smoke workflow uses:

`https://devs-hub-academy-cc.vercel.app`

## 7. Custom domains

Each organization can store a custom verification domain from Admin Settings.

The official QR automatically uses that domain when configured.

DNS and Vercel domain ownership still need to be configured at the hosting provider before the domain can resolve publicly.

## 8. Operational checks

Run locally or in CI:

```bash
npm run ci
npm run check
npm test
```

Production smoke test:

```bash
SITE_URL=https://your-domain.example npm run smoke
```

Database export:

```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run backup
```

## 9. Health endpoint

`GET /api/health`

Expected fields include:

- service status
- active storage provider
- authentication readiness
- private file storage readiness
- demo/production mode
- release commit
- environment
- timestamp
