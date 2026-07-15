-- Ask-the-curator log per the AI-features addendum: every public question
-- and answer with token usage. The table is also the durable per-visitor
-- daily rate limit and the monthly token-spend ledger for the cap.
CREATE TABLE "curator_questions" (
	"id" serial PRIMARY KEY,
	"visitor_id" text NOT NULL,
	"ip" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "curator_questions_created_idx" ON "curator_questions" ("created_at");
