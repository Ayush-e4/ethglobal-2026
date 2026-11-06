ALTER TABLE "world_checks" ADD COLUMN "ref" text;--> statement-breakpoint
ALTER TABLE "world_checks" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "world_checks" ADD COLUMN "used_at" timestamp with time zone;