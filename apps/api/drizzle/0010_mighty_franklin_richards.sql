CREATE TABLE "alert_channels" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"telegram_chat_id" text,
	"link_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_channels" ADD CONSTRAINT "alert_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_channels_chat_idx" ON "alert_channels" USING btree ("telegram_chat_id");