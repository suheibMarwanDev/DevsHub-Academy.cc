# Database foundation

Phase 1 moves DevsHub Academy from browser-only/demo storage toward a real PostgreSQL model.

## Preferred production database

Supabase PostgreSQL.

Required server-side environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DEFAULT_ORGANIZATION_SLUG=devshub-academy`

Never expose the service-role key inside `index.html` or `assets/app.js`.

## Schema

The first migration creates:

- `organizations`
- `organization_members`
- `courses`
- `students`
- `certificates`
- `verification_logs`
- `audit_logs`

Certificate serials are database-unique, certificate status is constrained to
`valid`, `revoked`, or `expired`, and the schema is ready for multi-organization use.

## Storage priority

The backend uses storage in this order:

1. Supabase PostgreSQL when configured.
2. Existing Redis/Upstash integration as a compatibility fallback.
3. Demo/browser fallback when neither cloud provider is configured.

## Applying the migration

Run `supabase/migrations/001_initial_schema.sql` in the Supabase SQL editor or via the Supabase CLI.

The migration seeds the DevsHub Academy organization and the existing demo certificate.

## Next phase

Authentication is intentionally not implemented in this migration. Phase 2 will connect users to `organization_members`, add real sessions, and create the necessary RLS policies.
