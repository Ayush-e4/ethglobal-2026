CREATE TABLE "deal_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drop_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"nullifier" text NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"hire_id" uuid,
	"pay_tx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_claims_person" UNIQUE("drop_id","nullifier"),
	CONSTRAINT "deal_claims_account" UNIQUE("drop_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "deal_claims" ADD CONSTRAINT "deal_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_claims" ADD CONSTRAINT "deal_claims_hire_id_hires_id_fk" FOREIGN KEY ("hire_id") REFERENCES "public"."hires"("id") ON DELETE set null ON UPDATE no action;