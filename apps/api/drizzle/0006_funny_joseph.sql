ALTER TABLE "hires" ADD COLUMN "watching" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hires" ADD COLUMN "rebooks_seen" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hires" ADD COLUMN "watch_note" text;