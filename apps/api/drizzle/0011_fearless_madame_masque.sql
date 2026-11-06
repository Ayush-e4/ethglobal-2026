CREATE TABLE "hire_alerts" (
	"hire_id" uuid PRIMARY KEY NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"message_id" integer NOT NULL,
	"photo" boolean DEFAULT false NOT NULL,
	"shown" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "hire_alerts" ADD CONSTRAINT "hire_alerts_hire_id_hires_id_fk" FOREIGN KEY ("hire_id") REFERENCES "public"."hires"("id") ON DELETE cascade ON UPDATE no action;