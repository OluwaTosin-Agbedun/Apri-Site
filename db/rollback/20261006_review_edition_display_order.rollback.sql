-- Rollback for 20261006_review_edition_display_order.sql: the order set in
-- Admin is lost and the default order (latest first, then newest) returns.
drop index if exists review_editions_display_order_idx;
alter table review_publication_editions drop column if exists display_position;
