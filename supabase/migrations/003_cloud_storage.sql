-- Phase 4: private cloud file storage for certificates, branding, and templates

alter table public.organizations
  add column if not exists logo_path text;

alter table public.certificates
  add column if not exists pdf_path text;

create table if not exists public.certificate_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  file_path text not null,
  preview_path text,
  file_type text,
  is_active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists certificate_templates_organization_idx
  on public.certificate_templates (organization_id, created_at desc);

create unique index if not exists certificate_templates_one_active_per_org_idx
  on public.certificate_templates (organization_id)
  where is_active = true;

drop trigger if exists certificate_templates_set_updated_at
  on public.certificate_templates;

create trigger certificate_templates_set_updated_at
before update on public.certificate_templates
for each row execute function public.set_updated_at();

alter table public.certificate_templates enable row level security;

-- Private bucket. Files are never exposed through public bucket URLs.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'devshub-assets',
  'devshub-assets',
  false,
  2621440,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage is accessed only from server-side code using the service-role key.
-- No public storage.objects policies are intentionally created.
