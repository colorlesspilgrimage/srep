ALTER TABLE `card` ADD `sched_state` text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE `card` ADD `learning_step` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `review_log` ADD `last_review_before` integer;--> statement-breakpoint
ALTER TABLE `review_log` ADD `reps_before` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `review_log` ADD `lapses_before` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `review_log` ADD `step_before` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `review_log` ADD `buried_sibling_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX `review_log_reviewed_at_idx` ON `review_log` (`reviewed_at`);--> statement-breakpoint
UPDATE card SET sched_state = CASE WHEN state IN ('suspended','buried') THEN CASE WHEN reps > 0 THEN 'review' ELSE 'new' END ELSE state END;
