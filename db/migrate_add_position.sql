-- Migration: add position column to cards
-- Run this against an existing database to avoid wiping data.
-- Safe to run multiple times (checks for column existence).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cards' AND column_name = 'position'
  ) THEN
    ALTER TABLE cards ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

    -- Backfill positions based on creation_time order within each deck
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY deck_id ORDER BY creation_time ASC) - 1 AS pos
      FROM cards
    )
    UPDATE cards SET position = ranked.pos
    FROM ranked WHERE cards.id = ranked.id;
  END IF;
END $$;
