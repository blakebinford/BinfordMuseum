-- Document transcription per the AI-features addendum: full text of the
-- object stored on the piece, with a reviewed flag (owner approval of AI
-- output) and an explicit public-display flag, default off. A transcription
-- appears on the public piece page only when reviewed AND public.
ALTER TABLE "pieces" ADD COLUMN "transcription" text;--> statement-breakpoint
ALTER TABLE "pieces" ADD COLUMN "transcription_reviewed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pieces" ADD COLUMN "transcription_public" boolean DEFAULT false NOT NULL;
