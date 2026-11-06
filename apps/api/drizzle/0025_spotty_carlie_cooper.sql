CREATE TABLE "merchants" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"account" text NOT NULL,
	"address" text NOT NULL,
	"key_hex" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_account_unique" UNIQUE("account")
);
--> statement-breakpoint
CREATE TABLE "pay_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_user_id" uuid NOT NULL,
	"nonce" bigint NOT NULL,
	"frame_hex" text NOT NULL,
	"amount_units" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"payer_user_id" uuid,
	"payer_chat_id" uuid,
	"live" boolean,
	"how" text,
	"live_ms" integer,
	"pay_tx" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_requests_frame_hex_unique" UNIQUE("frame_hex")
);
--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_requests" ADD CONSTRAINT "pay_requests_merchant_user_id_merchants_user_id_fk" FOREIGN KEY ("merchant_user_id") REFERENCES "public"."merchants"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_requests" ADD CONSTRAINT "pay_requests_payer_user_id_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_requests" ADD CONSTRAINT "pay_requests_payer_chat_id_chats_id_fk" FOREIGN KEY ("payer_chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_requests_merchant_idx" ON "pay_requests" USING btree ("merchant_user_id","created_at");