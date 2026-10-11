CREATE TABLE "card" (
	"id" text PRIMARY KEY NOT NULL,
	"note_id" text NOT NULL,
	"template_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"deck_id" text,
	"state" text NOT NULL,
	"due" bigint NOT NULL,
	"stability" double precision NOT NULL,
	"difficulty" double precision NOT NULL,
	"last_review" bigint,
	"reps" integer NOT NULL,
	"lapses" integer NOT NULL,
	"position" integer NOT NULL,
	"buried_until" bigint,
	"flags" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_template" (
	"id" text PRIMARY KEY NOT NULL,
	"note_type_id" text NOT NULL,
	"name" text NOT NULL,
	"ordinal" integer NOT NULL,
	"front_tpl" text NOT NULL,
	"back_tpl" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deck" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"preset_id" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"archived_at" bigint,
	CONSTRAINT "deck_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "deck_preset" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"new_per_day" integer NOT NULL,
	"reviews_per_day" integer NOT NULL,
	"desired_retention" double precision NOT NULL,
	"learning_steps" jsonb NOT NULL,
	"relearning_steps" jsonb NOT NULL,
	"max_interval" integer NOT NULL,
	"fsrs_params" jsonb NOT NULL,
	"bury_siblings" boolean NOT NULL,
	"new_order" text NOT NULL,
	CONSTRAINT "deck_preset_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"original_name" text NOT NULL,
	CONSTRAINT "media_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "note" (
	"id" text PRIMARY KEY NOT NULL,
	"note_type_id" text NOT NULL,
	"guid" text NOT NULL,
	"fields" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"checksum" text NOT NULL,
	"deleted_at" bigint,
	CONSTRAINT "note_guid_unique" UNIQUE("guid")
);
--> statement-breakpoint
CREATE TABLE "note_tag" (
	"note_id" text NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "note_tag_note_id_tag_pk" PRIMARY KEY("note_id","tag")
);
--> statement-breakpoint
CREATE TABLE "note_type" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"fields" jsonb NOT NULL,
	"css_class" text NOT NULL,
	"sort_field_idx" integer NOT NULL,
	CONSTRAINT "note_type_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "review_log" (
	"id" text PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"reviewed_at" bigint NOT NULL,
	"rating" integer NOT NULL,
	"state_before" text NOT NULL,
	"due_before" bigint NOT NULL,
	"stability_before" double precision NOT NULL,
	"difficulty_before" double precision NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"interval_after" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_template_id_card_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."card_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_deck_id_deck_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."deck"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_template" ADD CONSTRAINT "card_template_note_type_id_note_type_id_fk" FOREIGN KEY ("note_type_id") REFERENCES "public"."note_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck" ADD CONSTRAINT "deck_parent_id_deck_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."deck"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck" ADD CONSTRAINT "deck_preset_id_deck_preset_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."deck_preset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_note_type_id_note_type_id_fk" FOREIGN KEY ("note_type_id") REFERENCES "public"."note_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_tag" ADD CONSTRAINT "note_tag_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_log" ADD CONSTRAINT "review_log_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_note_template_ordinal_idx" ON "card" USING btree ("note_id","template_id","ordinal");--> statement-breakpoint
CREATE INDEX "card_deck_state_due_idx" ON "card" USING btree ("deck_id","state","due");--> statement-breakpoint
CREATE INDEX "card_note_id_idx" ON "card" USING btree ("note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "card_template_note_type_ordinal_idx" ON "card_template" USING btree ("note_type_id","ordinal");--> statement-breakpoint
CREATE INDEX "deck_parent_id_idx" ON "deck" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "note_checksum_idx" ON "note" USING btree ("note_type_id","checksum");--> statement-breakpoint
CREATE INDEX "note_deleted_at_idx" ON "note" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "note_tag_tag_idx" ON "note_tag" USING btree ("tag");--> statement-breakpoint
CREATE INDEX "review_log_card_idx" ON "review_log" USING btree ("card_id","reviewed_at");