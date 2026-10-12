ALTER TABLE "card" ADD COLUMN "sched_state" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "learning_step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_log" ADD COLUMN "last_review_before" bigint;--> statement-breakpoint
ALTER TABLE "review_log" ADD COLUMN "reps_before" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_log" ADD COLUMN "lapses_before" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_log" ADD COLUMN "step_before" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_log" ADD COLUMN "buried_sibling_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "review_log_reviewed_at_idx" ON "review_log" USING btree ("reviewed_at");--> statement-breakpoint
UPDATE card SET sched_state = CASE WHEN state IN ('suspended','buried') THEN CASE WHEN reps > 0 THEN 'review' ELSE 'new' END ELSE state END;
