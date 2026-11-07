CREATE TABLE `card` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`template_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`deck_id` text,
	`state` text NOT NULL,
	`due` integer NOT NULL,
	`stability` real NOT NULL,
	`difficulty` real NOT NULL,
	`last_review` integer,
	`reps` integer NOT NULL,
	`lapses` integer NOT NULL,
	`position` integer NOT NULL,
	`buried_until` integer,
	`flags` integer NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `note`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `card_template`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deck_id`) REFERENCES `deck`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_note_template_ordinal_idx` ON `card` (`note_id`,`template_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `card_deck_state_due_idx` ON `card` (`deck_id`,`state`,`due`);--> statement-breakpoint
CREATE INDEX `card_note_id_idx` ON `card` (`note_id`);--> statement-breakpoint
CREATE TABLE `card_template` (
	`id` text PRIMARY KEY NOT NULL,
	`note_type_id` text NOT NULL,
	`name` text NOT NULL,
	`ordinal` integer NOT NULL,
	`front_tpl` text NOT NULL,
	`back_tpl` text NOT NULL,
	FOREIGN KEY (`note_type_id`) REFERENCES `note_type`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_template_note_type_ordinal_idx` ON `card_template` (`note_type_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `deck` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`preset_id` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`parent_id`) REFERENCES `deck`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preset_id`) REFERENCES `deck_preset`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deck_path_unique` ON `deck` (`path`);--> statement-breakpoint
CREATE INDEX `deck_parent_id_idx` ON `deck` (`parent_id`);--> statement-breakpoint
CREATE TABLE `deck_preset` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`new_per_day` integer NOT NULL,
	`reviews_per_day` integer NOT NULL,
	`desired_retention` real NOT NULL,
	`learning_steps` text NOT NULL,
	`relearning_steps` text NOT NULL,
	`max_interval` integer NOT NULL,
	`fsrs_params` text NOT NULL,
	`bury_siblings` integer NOT NULL,
	`new_order` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deck_preset_name_unique` ON `deck_preset` (`name`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`original_name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_sha256_unique` ON `media` (`sha256`);--> statement-breakpoint
CREATE TABLE `note` (
	`id` text PRIMARY KEY NOT NULL,
	`note_type_id` text NOT NULL,
	`guid` text NOT NULL,
	`fields` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`checksum` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`note_type_id`) REFERENCES `note_type`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_guid_unique` ON `note` (`guid`);--> statement-breakpoint
CREATE INDEX `note_checksum_idx` ON `note` (`note_type_id`,`checksum`);--> statement-breakpoint
CREATE INDEX `note_deleted_at_idx` ON `note` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `note_tag` (
	`note_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`note_id`, `tag`),
	FOREIGN KEY (`note_id`) REFERENCES `note`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_tag_tag_idx` ON `note_tag` (`tag`);--> statement-breakpoint
CREATE TABLE `note_type` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`fields` text NOT NULL,
	`css_class` text NOT NULL,
	`sort_field_idx` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_type_name_unique` ON `note_type` (`name`);--> statement-breakpoint
CREATE TABLE `review_log` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`reviewed_at` integer NOT NULL,
	`rating` integer NOT NULL,
	`state_before` text NOT NULL,
	`due_before` integer NOT NULL,
	`stability_before` real NOT NULL,
	`difficulty_before` real NOT NULL,
	`elapsed_ms` integer NOT NULL,
	`interval_after` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_log_card_idx` ON `review_log` (`card_id`,`reviewed_at`);