-- The order review editions appear in on the Publications page (and in the
-- review library), set from Admin -> Review Library. Additive and idempotent.
-- Null keeps the existing order (latest first, then newest); a position,
-- lowest first, is set only when an owner moves an edition.
alter table review_publication_editions add column if not exists display_position integer;
create index if not exists review_editions_display_order_idx
  on review_publication_editions (series, display_position);
