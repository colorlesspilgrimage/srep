CREATE TABLE "sync_receipts" (
	"device_id" text NOT NULL,
	"review_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"log_id" text,
	"result_json" text NOT NULL,
	"client_occurred_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	PRIMARY KEY("device_id", "review_id")
);
--> statement-breakpoint
