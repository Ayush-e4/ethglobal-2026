CREATE TABLE "wallet_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"calls" jsonb NOT NULL,
	"deadline" bigint NOT NULL,
	"digest" text NOT NULL,
	"meta" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "wallet_ops" ADD CONSTRAINT "wallet_ops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;