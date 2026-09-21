-- Phase 5-8 foundation: multi-tenant branding, analytics, and rate limits

alter table public.organizations
  add column if not exists display_name text,
  add column if not exists verification_slug text,
  add column if not exists custom_domain text,
  add column if not exists primary_color text default '#0B7783',
  add column if not exists secondary_color text default '#0B2B34';

update public.organizations
set
  display_name = coalesce(display_name, name),
  verification_slug = coalesce(verification_slug, slug)
where display_name is null or verification_slug is null;

create unique index if not exists organizations_verification_slug_unique
  on public.organizations (verification_slug)
  where verification_slug is not null;

create unique index if not exists organizations_custom_domain_unique
  on public.organizations (lower(custom_domain))
  where custom_domain is not null;

create table if not exists public.rate_limit_buckets (
  bucket_key text primary key,
  request_count integer not null default 0,
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_reset timestamptz;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;

  insert into public.rate_limit_buckets (
    bucket_key,
    request_count,
    reset_at,
    updated_at
  )
  values (
    p_key,
    1,
    now() + make_interval(secs => p_window_seconds),
    now()
  )
  on conflict (bucket_key)
  do update set
    request_count = case
      when rate_limit_buckets.reset_at <= now() then 1
      else rate_limit_buckets.request_count + 1
    end,
    reset_at = case
      when rate_limit_buckets.reset_at <= now()
        then now() + make_interval(secs => p_window_seconds)
      else rate_limit_buckets.reset_at
    end,
    updated_at = now()
  returning request_count, reset_at
  into v_count, v_reset;

  return v_count <= p_limit;
end;
$$;

create or replace function public.get_org_dashboard_metrics(
  p_organization_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'certificatesTotal',
      (select count(*) from public.certificates c
       where c.organization_id = p_organization_id),
    'validCertificates',
      (select count(*) from public.certificates c
       where c.organization_id = p_organization_id
         and c.status = 'valid'),
    'revokedCertificates',
      (select count(*) from public.certificates c
       where c.organization_id = p_organization_id
         and c.status = 'revoked'),
    'expiredCertificates',
      (select count(*) from public.certificates c
       where c.organization_id = p_organization_id
         and c.status = 'expired'),
    'issuedThisMonth',
      (select count(*) from public.certificates c
       where c.organization_id = p_organization_id
         and c.issued_at >= date_trunc('month', current_date)::date),
    'verificationsToday',
      (select count(*)
       from public.verification_logs v
       join public.certificates c on c.id = v.certificate_id
       where c.organization_id = p_organization_id
         and v.created_at >= date_trunc('day', now())),
    'verifications30d',
      (select count(*)
       from public.verification_logs v
       join public.certificates c on c.id = v.certificate_id
       where c.organization_id = p_organization_id
         and v.created_at >= now() - interval '30 days'),
    'serialToday',
      (select count(*)
       from public.verification_logs v
       join public.certificates c on c.id = v.certificate_id
       where c.organization_id = p_organization_id
         and v.created_at >= date_trunc('day', now())
         and v.source = 'serial'),
    'qrToday',
      (select count(*)
       from public.verification_logs v
       join public.certificates c on c.id = v.certificate_id
       where c.organization_id = p_organization_id
         and v.created_at >= date_trunc('day', now())
         and v.source = 'qr'),
    'directToday',
      (select count(*)
       from public.verification_logs v
       join public.certificates c on c.id = v.certificate_id
       where c.organization_id = p_organization_id
         and v.created_at >= date_trunc('day', now())
         and v.source = 'direct_link'),
    'successfulToday',
      (select count(*)
       from public.verification_logs v
       join public.certificates c on c.id = v.certificate_id
       where c.organization_id = p_organization_id
         and v.created_at >= date_trunc('day', now())
         and v.result = 'valid'),
    'daily30d',
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'date', d.day::date,
          'count', coalesce(x.count, 0)
        ) order by d.day)
        from generate_series(
          date_trunc('day', now()) - interval '29 days',
          date_trunc('day', now()),
          interval '1 day'
        ) d(day)
        left join (
          select
            date_trunc('day', v.created_at) day,
            count(*) count
          from public.verification_logs v
          join public.certificates c on c.id = v.certificate_id
          where c.organization_id = p_organization_id
            and v.created_at >= now() - interval '30 days'
          group by 1
        ) x on x.day = d.day
      ), '[]'::jsonb)
  );
$$;

create index if not exists rate_limit_buckets_reset_at_idx
  on public.rate_limit_buckets (reset_at);

-- Housekeeping can delete expired buckets periodically.
