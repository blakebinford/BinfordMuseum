-- Pieces move from the is_public boolean to a status enum per the AI-features
-- addendum: `prospect` (under consideration, saved from the field companion,
-- not owned), `draft` (owned, not public), `published` (in the gallery).
-- Existing rows map true -> published, false -> draft. Runs after the seed
-- migration, which still inserts with is_public; this migration converts it.
CREATE TYPE "piece_status" AS ENUM('prospect', 'draft', 'published');--> statement-breakpoint
ALTER TABLE "pieces" ADD COLUMN "status" "piece_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
UPDATE "pieces" SET "status" = CASE WHEN "is_public" THEN 'published'::"piece_status" ELSE 'draft'::"piece_status" END;--> statement-breakpoint
ALTER TABLE "pieces" DROP COLUMN "is_public";
