# Admin authentication

Phase 2 adds real admin authentication while preserving the customer-facing demo workflow.

## Modes

### Demo mode

`DEMO_MODE=true`

- The **Verifier** and **Admin** tabs stay visible and accessible.
- This preserves the current sales/demo experience.
- No login screen interrupts the customer demonstration.

### Production mode

`DEMO_MODE=false`

- Public certificate verification remains available without login.
- Opening Admin requires a valid Supabase Auth session.
- Listing all certificates requires authentication.
- Creating/updating certificates requires the `owner`, `admin`, or `issuer` role.
- `viewer` can open the admin data view but cannot issue certificates.

## Session security

The backend stores Supabase access and refresh tokens in:

- `HttpOnly` cookies
- `SameSite=Lax`
- `Secure` cookies in Vercel/production

Tokens are not stored in localStorage and are not readable by frontend JavaScript.

## Required environment variables

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DEFAULT_ORGANIZATION_SLUG=devshub-academy
DEMO_MODE=false
```

The service-role key must remain server-side.

## First admin setup

1. Apply:
   - `001_initial_schema.sql`
   - `002_auth_membership.sql`
2. Create a user in Supabase Authentication.
3. Copy that user's UUID.
4. Add the user to the DevsHub organization:

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

5. Set `DEMO_MODE=false` only when the production login should become active.

## Auth API

- `POST /api/auth/login`
- `GET /api/auth/session`
- `POST /api/auth/logout`

Public verification remains available through:

- `GET /api/certificates?serial=...`

The unfiltered certificate list is protected in production.
