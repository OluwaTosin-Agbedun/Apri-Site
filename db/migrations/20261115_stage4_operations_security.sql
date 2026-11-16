-- Additive Stage 4 controls. No emails, provider calls, grant changes or cleanup.
begin;
set local lock_timeout = '5s';

create table if not exists admin_security (
  admin_id uuid primary key references admins(id) on delete cascade,
  session_version bigint not null default 0 check (session_version >= 0),
  totp_ciphertext text,
  last_totp_step bigint,
  recovery_hashes text[] not null default '{}',
  challenge_window_started timestamptz not null default now(),
  challenge_issues integer not null default 0,
  factor_window_started timestamptz not null default now(),
  factor_attempts integer not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists admin_security_policy (
  singleton boolean primary key default true check (singleton),
  require_mfa boolean not null default false,
  updated_by uuid references admins(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into admin_security_policy(singleton) values(true) on conflict do nothing;
insert into app_settings(key,value) values('staff_security_schema_v1','ready') on conflict(key) do nothing;

create table if not exists admin_auth_challenges (
  token_hash text primary key,
  admin_id uuid not null references admins(id) on delete cascade,
  kind text not null check(kind in ('verify','enroll')),
  session_version bigint not null,
  enrollment_ciphertext text,
  attempts integer not null default 0 check(attempts between 0 and 5),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists admin_auth_challenges_admin_recent on admin_auth_challenges(admin_id, created_at desc);

create table if not exists admin_security_events (
  id uuid primary key default gen_random_uuid(),
  actor_admin_id uuid references admins(id) on delete set null,
  target_admin_id uuid references admins(id) on delete set null,
  event_type text not null check(length(event_type) between 1 and 80),
  created_at timestamptz not null default now()
);
create index if not exists admin_security_events_recent on admin_security_events(created_at desc);

-- Minimal verified webhook evidence. No addresses, subjects, bodies, codes or URLs.
create table if not exists email_delivery_inbox (
  event_id text primary key check(length(event_id) between 1 and 200),
  provider_message_id text not null check(length(provider_message_id) between 1 and 200),
  event_type text not null check(event_type in ('email.sent','email.delivered','email.opened','email.clicked','email.bounced','email.failed','email.complained','email.delivery_delayed','email.suppressed')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error_code text
);
create index if not exists email_delivery_inbox_due on email_delivery_inbox(next_attempt_at) where applied_at is null;
create index if not exists email_delivery_inbox_message on email_delivery_inbox(provider_message_id, occurred_at desc);

create table if not exists operations_settings (
  singleton boolean primary key default true check(singleton),
  incident_owner_id uuid references admins(id) on delete set null,
  deputy_id uuid references admins(id) on delete set null,
  alerts_email_enabled boolean not null default false,
  poll_stale_hours integer not null default 30 check(poll_stale_hours between 1 and 168),
  queue_stale_hours integer not null default 6 check(queue_stale_hours between 1 and 168),
  last_checked_at timestamptz,
  check_lease_token uuid,
  check_lease_until timestamptz,
  updated_by uuid references admins(id) on delete set null,
  updated_at timestamptz not null default now(),
  check(incident_owner_id is null or deputy_id is null or incident_owner_id <> deputy_id)
);
insert into operations_settings(singleton) values(true) on conflict do nothing;

create table if not exists operations_alerts (
  alert_key text primary key,
  severity text not null check(severity in ('attention','critical')),
  message text not null,
  opened_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references admins(id) on delete set null,
  notification_state text not null default 'disabled' check(notification_state in ('disabled','pending','sending','accepted','failed','unknown')),
  notification_generation integer not null default 1,
  notification_claim_token uuid,
  notification_claim_until timestamptz,
  notification_attempts integer not null default 0,
  next_notification_at timestamptz not null default now(),
  provider_message_id text,
  notified_at timestamptz,
  last_notification_error text
);

create table if not exists operations_checkpoints (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('backup','restore','incident_exercise')),
  result text not null check(result in ('pass','fail')),
  evidence_ref text not null check(length(evidence_ref) between 1 and 160),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references admins(id) on delete set null
);

-- No policy is seeded and no automatic deletion is enabled.
create table if not exists privacy_retention_policies (
  bucket text primary key check(bucket in ('login_attempts','subscriber_tokens','review_tokens','staff_challenges','applied_email_events')),
  days integer not null check(days between 7 and 3650),
  reason text not null check(length(reason) between 10 and 300),
  approved_by uuid not null references admins(id),
  approved_at timestamptz not null default now()
);
create table if not exists privacy_cleanup_events (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  cutoff timestamptz not null,
  deleted_count integer not null check(deleted_count >= 0),
  actor_admin_id uuid references admins(id) on delete set null,
  created_at timestamptz not null default now()
);
commit;
