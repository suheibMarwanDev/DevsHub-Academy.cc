-- Phase 9: database row-level security policies

alter table public.rate_limit_buckets enable row level security;

drop policy if exists organizations_member_select on public.organizations;
create policy organizations_member_select
on public.organizations
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = organizations.id
      and m.user_id = auth.uid()
  )
);

drop policy if exists organization_members_self_select on public.organization_members;
create policy organization_members_self_select
on public.organization_members
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists courses_member_select on public.courses;
create policy courses_member_select
on public.courses
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = courses.organization_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists courses_issuer_write on public.courses;
create policy courses_issuer_write
on public.courses
for all
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = courses.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin','issuer')
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = courses.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin','issuer')
  )
);

drop policy if exists students_member_select on public.students;
create policy students_member_select
on public.students
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = students.organization_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists students_issuer_write on public.students;
create policy students_issuer_write
on public.students
for all
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = students.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin','issuer')
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = students.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin','issuer')
  )
);

drop policy if exists certificates_member_select on public.certificates;
create policy certificates_member_select
on public.certificates
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = certificates.organization_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists certificates_issuer_insert on public.certificates;
create policy certificates_issuer_insert
on public.certificates
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = certificates.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin','issuer')
  )
);

drop policy if exists certificates_issuer_update on public.certificates;
create policy certificates_issuer_update
on public.certificates
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = certificates.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin','issuer')
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = certificates.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin','issuer')
  )
);

drop policy if exists templates_member_select on public.certificate_templates;
create policy templates_member_select
on public.certificate_templates
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = certificate_templates.organization_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists templates_issuer_write on public.certificate_templates;
create policy templates_issuer_write
on public.certificate_templates
for all
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = certificate_templates.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin','issuer')
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = certificate_templates.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin','issuer')
  )
);

drop policy if exists verification_logs_member_select on public.verification_logs;
create policy verification_logs_member_select
on public.verification_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.certificates c
    join public.organization_members m
      on m.organization_id = c.organization_id
    where c.id = verification_logs.certificate_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_admin_select
on public.audit_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = audit_logs.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

-- rate_limit_buckets intentionally has no authenticated policy.
-- Only the server-side service role can use it.
