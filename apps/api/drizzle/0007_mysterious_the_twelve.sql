CREATE TABLE "world_bonuses" (
	"world_iss" text NOT NULL,
	"world_sub" text NOT NULL,
	"user_id" uuid,
	"units" bigint NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"tx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_bonuses_world_iss_world_sub_pk" PRIMARY KEY("world_iss","world_sub")
);
--> statement-breakpoint
CREATE TABLE "world_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"user_code" text NOT NULL,
	"link" text NOT NULL,
	"device_code" text NOT NULL,
	"interval_s" integer NOT NULL,
	"started_at_s" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "world_iss" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "world_sub" text;--> statement-breakpoint
ALTER TABLE "world_bonuses" ADD CONSTRAINT "world_bonuses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_checks" ADD CONSTRAINT "world_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "world_checks_user_idx" ON "world_checks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_world_idx" ON "users" USING btree ("world_iss","world_sub");