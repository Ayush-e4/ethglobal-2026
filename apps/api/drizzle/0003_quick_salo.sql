CREATE TABLE "wallets" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"hedera_id" text,
	"status" text DEFAULT 'creating' NOT NULL,
	"gift_units" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "passkeys" ADD COLUMN "on_wallet" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;