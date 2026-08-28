-- Additive, idempotent storage for per-client Papermark folders and their synced links.
alter table subscribers add column if not exists papermark_folder_id text;
alter table briefing_requests add column if not exists papermark_folder_id text;

create table if not exists papermark_client_documents (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid references subscribers(id) on delete cascade,
  briefing_request_id uuid references briefing_requests(id) on delete cascade,
  papermark_document_id text not null,
  papermark_link_id text,
  title text not null,
  share_url text not null,
  synced_at timestamptz not null default now(),
  constraint papermark_client_documents_one_principal check (
    (subscriber_id is not null and briefing_request_id is null) or
    (subscriber_id is null and briefing_request_id is not null)
  )
);
create unique index if not exists papermark_client_documents_subscriber_doc_key
  on papermark_client_documents(subscriber_id, papermark_document_id)
  where subscriber_id is not null;
create unique index if not exists papermark_client_documents_briefing_doc_key
  on papermark_client_documents(briefing_request_id, papermark_document_id)
  where briefing_request_id is not null;
create index if not exists papermark_client_documents_subscriber_idx
  on papermark_client_documents(subscriber_id, synced_at desc);
create index if not exists papermark_client_documents_briefing_idx
  on papermark_client_documents(briefing_request_id, synced_at desc);
create unique index if not exists subscribers_active_papermark_folder_key
  on subscribers(papermark_folder_id)
  where papermark_folder_id is not null and lower(status) = 'active';
create unique index if not exists briefing_active_papermark_folder_key
  on briefing_requests(papermark_folder_id)
  where papermark_folder_id is not null and lower(status) = 'active';
