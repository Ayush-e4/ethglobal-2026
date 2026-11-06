CREATE TABLE "ratings" (
	"rater" text NOT NULL,
	"agent" text NOT NULL,
	"user_id" uuid NOT NULL,
	"hire_id" uuid NOT NULL,
	"score" smallint NOT NULL,
	"status" text DEFAULT 'posting' NOT NULL,
	"arkiv_key" text,
	"arkiv_tx" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_rater_agent_pk" PRIMARY KEY("rater","agent")
);
--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ratings_hire_idx" ON "ratings" USING btree ("hire_id");