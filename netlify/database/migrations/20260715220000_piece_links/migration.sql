-- Connection detection per the AI-features addendum: directional links
-- between pieces with a one-sentence reason. created_by reuses the
-- note_author enum (ai or owner); AI proposals start unapproved and appear
-- publicly (as related pieces with captions) only once approved.
CREATE TABLE "piece_links" (
	"id" serial PRIMARY KEY,
	"from_piece_id" integer NOT NULL,
	"to_piece_id" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" "note_author" NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "piece_links_pair_unique" UNIQUE("from_piece_id","to_piece_id")
);
--> statement-breakpoint
CREATE INDEX "piece_links_from_idx" ON "piece_links" ("from_piece_id");--> statement-breakpoint
CREATE INDEX "piece_links_to_idx" ON "piece_links" ("to_piece_id");--> statement-breakpoint
ALTER TABLE "piece_links" ADD CONSTRAINT "piece_links_from_piece_id_pieces_id_fkey" FOREIGN KEY ("from_piece_id") REFERENCES "pieces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "piece_links" ADD CONSTRAINT "piece_links_to_piece_id_pieces_id_fkey" FOREIGN KEY ("to_piece_id") REFERENCES "pieces"("id") ON DELETE CASCADE;
