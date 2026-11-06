CREATE TABLE "agent_reviews" (
	"agent" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"operator" text NOT NULL,
	"owner_user_id" uuid,
	"checks" jsonb NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"note" text,
	"arkiv_key" text,
	"arkiv_at" timestamp with time zone,
	"checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_reviews" ADD CONSTRAINT "agent_reviews_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;