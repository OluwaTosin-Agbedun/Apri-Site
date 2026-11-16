-- Roll forward after use. Removing security state would restore old cookies'
-- privileges and removing operational evidence would lose incident history.
begin;
set local lock_timeout='5s';
do $$
declare
  name text;
  used boolean;
begin
  foreach name in array array['admin_security','admin_auth_challenges','admin_security_events',
    'email_delivery_inbox','operations_alerts','operations_checkpoints','privacy_retention_policies','privacy_cleanup_events'] loop
    if to_regclass('public.'||name) is not null then
      execute format('select exists(select 1 from %I)',name) into used;
      if used then raise exception 'Refusing Stage 4 rollback: % contains security or operational evidence. Roll forward instead.',name; end if;
    end if;
  end loop;
  if to_regclass('public.admin_security_policy') is not null then
    execute 'select exists(select 1 from admin_security_policy where require_mfa=true or updated_by is not null)' into used;
    if used then raise exception 'Refusing Stage 4 rollback: the staff policy has been used.'; end if;
  end if;
  if to_regclass('public.operations_settings') is not null then
    execute 'select exists(select 1 from operations_settings where updated_by is not null or incident_owner_id is not null or deputy_id is not null or alerts_email_enabled=true)' into used;
    if used then raise exception 'Refusing Stage 4 rollback: operational settings have been approved.'; end if;
  end if;
end $$;
drop table if exists privacy_cleanup_events;
drop table if exists privacy_retention_policies;
drop table if exists operations_checkpoints;
drop table if exists operations_alerts;
drop table if exists operations_settings;
drop table if exists email_delivery_inbox;
drop table if exists admin_security_events;
drop table if exists admin_auth_challenges;
drop table if exists admin_security_policy;
drop table if exists admin_security;
delete from app_settings where key='staff_security_schema_v1';
commit;
