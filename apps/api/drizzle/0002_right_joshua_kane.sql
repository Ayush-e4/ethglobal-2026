CREATE TABLE "hires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"quote_key" text NOT NULL,
	"agent_name" text NOT NULL,
	"title" text NOT NULL,
	"fee_units" bigint NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'paying' NOT NULL,
	"escrow_id" text,
	"pay_tx" text,
	"undo_until" timestamp with time zone,
	"job_url" text,
	"booking_ref" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"mandate_id" bigint NOT NULL,
	"owner" text NOT NULL,
	"owner_account" text NOT NULL,
	"payee" text NOT NULL,
	"budget_units" bigint NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"key" text PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"agent_name" text NOT NULL,
	"agent_address" text NOT NULL,
	"endpoint" text NOT NULL,
	"fee_units" bigint NOT NULL,
	"summary" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hires" ADD CONSTRAINT "hires_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hires" ADD CONSTRAINT "hires_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limits" ADD CONSTRAINT "limits_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hires_chat_idx" ON "hires" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "hires_status_idx" ON "hires" USING btree ("status");--> statement-breakpoint
CREATE INDEX "limits_chat_idx" ON "limits" USING btree ("chat_id");