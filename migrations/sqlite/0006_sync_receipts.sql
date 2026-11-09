CREATE TABLE `sync_receipts` (
	`device_id` TEXT NOT NULL,
	`review_id` TEXT NOT NULL,
	`request_hash` TEXT NOT NULL,
	`outcome` TEXT NOT NULL,
	`log_id` TEXT,
	`result_json` TEXT NOT NULL,
	`client_occurred_at` INTEGER NOT NULL,
	`created_at` INTEGER NOT NULL,
	PRIMARY KEY(`device_id`, `review_id`)
);
--> statement-breakpoint
