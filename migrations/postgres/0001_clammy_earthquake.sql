CREATE TABLE "auth_challenge" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"sign_count" bigint NOT NULL,
	"transports" jsonb NOT NULL,
	"kind" text NOT NULL,
	"nickname" text NOT NULL,
	"created_at" bigint NOT NULL,
	"last_used_at" bigint,
	CONSTRAINT "auth_credential_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "auth_recovery" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" bigint
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" bigint NOT NULL,
	"last_seen_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"user_agent" text NOT NULL,
	CONSTRAINT "session_token_hash_unique" UNIQUE("token_hash")
);
