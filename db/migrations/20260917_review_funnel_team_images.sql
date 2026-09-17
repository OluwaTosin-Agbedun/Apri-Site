-- APRI review acquisition funnel and managed team imagery.
-- Additive, idempotent, and atomic. No subscriber or Papermark row is rewritten.
begin;

create table if not exists team_member_images (
  member_key text primary key,
  image_url text,
  blob_url text,
  alt_text text not null default '',
  content_type text,
  updated_by uuid references admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_member_images_key_check check (member_key in (
    'osita-chidoka','temitayo-shenkoya','danjuma-iyaji','izuchukwu-anyanwu',
    'sarah-eke','ijeoma-achebe','nonso-momah'
  )),
  constraint team_member_images_url_check check (
    image_url is null or image_url ~ '^https://'
  )
);

create table if not exists review_prospects (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  organisation text,
  role_profession text not null,
  user_type text not null,
  self_reported_source text not null,
  attributed_source text not null,
  first_utm_source text, first_utm_medium text, first_utm_campaign text,
  first_utm_term text, first_utm_content text,
  latest_utm_source text, latest_utm_medium text, latest_utm_campaign text,
  latest_utm_term text, latest_utm_content text,
  safe_referrer_host text,
  status text not null default 'Review Requested',
  requested_at timestamptz not null default now(),
  verified_at timestamptz,
  access_sent_at timestamptz,
  manager_notified_at timestamptz,
  manager_notification_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_prospect_user_type_check check (user_type in (
    'Individual professional','Small professional team','Corporate or institutional'
  )),
  constraint review_prospect_source_check check (self_reported_source in (
    'WhatsApp','Google','Facebook','X','LinkedIn','Referral','Other'
  )),
  constraint review_prospect_attributed_source_check check (attributed_source in (
    'WhatsApp','Google','Facebook','X','LinkedIn','Referral','Direct traffic','Other'
  )),
  constraint review_prospect_status_check check (status in (
    'Review Requested','Email Verified','Review Access Sent','Subscription Requested',
    'Agreement Sent','Agreement Signed','Invoice Sent','Payment Confirmed',
    'Access Activated','Active Subscriber'
  ))
);
create unique index if not exists review_prospects_email_key on review_prospects(lower(email));
create index if not exists review_prospects_created_idx on review_prospects(created_at desc);
create index if not exists review_prospects_status_idx on review_prospects(status, created_at desc);

create table if not exists review_prospect_events (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references review_prospects(id) on delete restrict,
  event_type text not null,
  from_status text,
  to_status text,
  detail text,
  actor_admin_id uuid references admins(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists review_prospect_events_prospect_idx
  on review_prospect_events(prospect_id, created_at desc);

create or replace function reject_review_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'review_prospect_events is append-only';
end;
$$;

drop trigger if exists review_prospect_events_no_update on review_prospect_events;
create trigger review_prospect_events_no_update
before update on review_prospect_events for each row execute function reject_review_event_mutation();
drop trigger if exists review_prospect_events_no_delete on review_prospect_events;
create trigger review_prospect_events_no_delete
before delete on review_prospect_events for each row execute function reject_review_event_mutation();

create table if not exists review_tokens (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references review_prospects(id) on delete restrict,
  purpose text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint review_tokens_purpose_check check (purpose in ('email_verification','review_access')),
  constraint review_tokens_expiry_check check (expires_at > created_at)
);
create unique index if not exists review_tokens_hash_key on review_tokens(token_hash);
create index if not exists review_tokens_lookup_idx on review_tokens(purpose, token_hash, expires_at);
create unique index if not exists review_tokens_one_unused_per_purpose
  on review_tokens(prospect_id, purpose) where consumed_at is null;

create or replace function protect_review_token_security_fields()
returns trigger language plpgsql as $$
begin
  if old.token_hash is distinct from new.token_hash
     or old.prospect_id is distinct from new.prospect_id
     or old.purpose is distinct from new.purpose
     or old.created_at is distinct from new.created_at
     or (old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at) then
    raise exception 'review token security fields are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists review_tokens_protect_security_fields on review_tokens;
create trigger review_tokens_protect_security_fields
before update on review_tokens for each row execute function protect_review_token_security_fields();

create table if not exists review_rate_limits (
  id bigserial primary key,
  action text not null,
  identity_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists review_rate_limits_lookup_idx
  on review_rate_limits(action, identity_hash, created_at desc);

create table if not exists review_subscription_requests (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null unique references review_prospects(id) on delete restrict,
  plan text not null,
  requester_name text not null,
  requester_email text not null,
  phone text not null,
  legal_billing_name text not null,
  billing_email text not null,
  billing_address text not null,
  city_state text not null,
  country text not null,
  tax_reference text,
  authorised_users jsonb not null,
  terms_accepted_at timestamptz not null,
  agreement_type text not null,
  docusign_reference text,
  agreement_sent_at timestamptz,
  agreement_signed_at timestamptz,
  invoice_reference text,
  invoice_sent_at timestamptz,
  payment_reference text,
  payment_confirmed_at timestamptz,
  papermark_access_prepared_at timestamptz,
  subscription_starts_at timestamptz,
  subscription_ends_at timestamptz,
  internal_notes text,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_subscription_plan_check check (plan in ('Individual','Professional')),
  constraint review_subscription_agreement_check check (agreement_type in (
    'APRI Individual Subscription','APRI Professional Subscription'
  )),
  constraint review_subscription_users_check check (
    jsonb_typeof(authorised_users) = 'array' and jsonb_array_length(authorised_users) between 1 and 3
  )
);

insert into app_settings(key, value) values ('review_funnel_migration', '20260917')
on conflict (key) do nothing;

commit;
