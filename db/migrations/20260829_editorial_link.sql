-- Link Data Room documents to their APRI editorial publication record.
--
-- The join lets the portal show clean CMS titles, summaries and edition dates
-- instead of raw Papermark filenames, while keeping Papermark as the sync
-- source for page counts, timestamps and folder placement.
--
-- Idempotent: uses IF NOT EXISTS on both the column and the index.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'papermark_dataroom_documents'
      AND column_name = 'publication_id'
  ) THEN
    ALTER TABLE papermark_dataroom_documents
      ADD COLUMN publication_id uuid REFERENCES documents(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pdd_publication_id
  ON papermark_dataroom_documents (publication_id)
  WHERE publication_id IS NOT NULL;
