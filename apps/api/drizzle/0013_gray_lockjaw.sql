CREATE TABLE "travellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"is_self" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "traveller_id" uuid;--> statement-breakpoint
ALTER TABLE "hires" ADD COLUMN "guest_name" text;--> statement-breakpoint
ALTER TABLE "hires" ADD COLUMN "guest_email" text;--> statement-breakpoint
ALTER TABLE "travellers" ADD CONSTRAINT "travellers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "travellers_user_idx" ON "travellers" USING btree ("user_id");