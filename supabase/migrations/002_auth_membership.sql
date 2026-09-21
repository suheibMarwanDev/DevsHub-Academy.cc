-- Phase 2: authentication membership integrity

alter table public.organization_members
  drop constraint if exists organization_members_user_id_fkey;

alter table public.organization_members
  add constraint organization_members_user_id_fkey
  foreign key (user_id)
  references auth.users(id)
  on delete cascade;

alter table public.audit_logs
  drop constraint if exists audit_logs_actor_user_id_fkey;

alter table public.audit_logs
  add constraint audit_logs_actor_user_id_fkey
  foreign key (actor_user_id)
  references auth.users(id)
  on delete set null;

create index if not exists organization_members_user_id_idx
  on public.organization_members (user_id);

-- Access to these tables remains server-mediated through the service role.
-- Direct browser policies can be added later if the product ever needs
-- client-side Supabase data access.
