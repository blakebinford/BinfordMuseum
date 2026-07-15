CREATE TYPE "condition_grade" AS ENUM('fine', 'very_good', 'good', 'fair', 'poor');--> statement-breakpoint
CREATE TYPE "image_kind" AS ENUM('front', 'back', 'detail');--> statement-breakpoint
CREATE TYPE "note_author" AS ENUM('ai', 'owner');--> statement-breakpoint
CREATE TYPE "object_type" AS ENUM('map', 'document', 'currency', 'stereoview', 'photograph', 'print', 'certificate', 'object');--> statement-breakpoint
CREATE TYPE "valuation_method" AS ENUM('ai_research', 'comparable_sale', 'appraisal', 'owner_estimate');--> statement-breakpoint
CREATE TABLE "acquisitions" (
	"id" serial PRIMARY KEY,
	"piece_id" integer NOT NULL,
	"acquired_on" date,
	"source" text,
	"price_paid_cents" bigint,
	"provenance_text" text,
	"is_public_provenance" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "condition_reports" (
	"id" serial PRIMARY KEY,
	"piece_id" integer NOT NULL,
	"reported_on" date NOT NULL,
	"grade" "condition_grade" NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "piece_images" (
	"id" serial PRIMARY KEY,
	"piece_id" integer NOT NULL,
	"blob_key" text NOT NULL UNIQUE,
	"kind" "image_kind" DEFAULT 'front'::"image_kind" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pieces" (
	"id" serial PRIMARY KEY,
	"accession" text NOT NULL UNIQUE,
	"title" text NOT NULL,
	"maker" text,
	"date_display" text,
	"date_sort_year" integer,
	"medium" text,
	"dimensions" text,
	"object_type" "object_type" NOT NULL,
	"meta" text,
	"room_id" integer,
	"room_order" integer,
	"label" text DEFAULT '' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_notes" (
	"id" serial PRIMARY KEY,
	"piece_id" integer NOT NULL,
	"body" text NOT NULL,
	"sources" jsonb,
	"created_by" "note_author" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" serial PRIMARY KEY,
	"numeral" text NOT NULL UNIQUE,
	"title" text NOT NULL,
	"date_range" text NOT NULL,
	"wall_text" text NOT NULL,
	"sort" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valuations" (
	"id" serial PRIMARY KEY,
	"piece_id" integer NOT NULL,
	"valued_on" date NOT NULL,
	"method" "valuation_method" NOT NULL,
	"amount_low_cents" bigint,
	"amount_high_cents" bigint,
	"currency" text DEFAULT 'USD' NOT NULL,
	"comparables" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "acquisitions_piece_idx" ON "acquisitions" ("piece_id");--> statement-breakpoint
CREATE INDEX "condition_reports_piece_idx" ON "condition_reports" ("piece_id");--> statement-breakpoint
CREATE INDEX "piece_images_piece_idx" ON "piece_images" ("piece_id");--> statement-breakpoint
CREATE INDEX "pieces_room_idx" ON "pieces" ("room_id");--> statement-breakpoint
CREATE INDEX "research_notes_piece_idx" ON "research_notes" ("piece_id");--> statement-breakpoint
CREATE INDEX "valuations_piece_idx" ON "valuations" ("piece_id");--> statement-breakpoint
ALTER TABLE "acquisitions" ADD CONSTRAINT "acquisitions_piece_id_pieces_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "pieces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "condition_reports" ADD CONSTRAINT "condition_reports_piece_id_pieces_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "pieces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "piece_images" ADD CONSTRAINT "piece_images_piece_id_pieces_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "pieces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_piece_id_pieces_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "pieces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_piece_id_pieces_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "pieces"("id") ON DELETE CASCADE;