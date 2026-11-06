CREATE TABLE "agent_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"escrow_id" text NOT NULL,
	"agent" text NOT NULL,
	"merchant" text NOT NULL,
	"amount" double precision NOT NULL,
	"currency" text NOT NULL,
	"amount_units" bigint NOT NULL,
	"last4" text NOT NULL,
	"status" text DEFAULT 'authorized' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_cards_escrow_id_unique" UNIQUE("escrow_id")
);
--> statement-breakpoint
ALTER TABLE "hires" ADD COLUMN "price_units" bigint;--> statement-breakpoint
ALTER TABLE "hires" ADD COLUMN "card" jsonb;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "price_units" bigint;