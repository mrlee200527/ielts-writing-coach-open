CREATE TABLE `domain_events` (
	`id` text PRIMARY KEY NOT NULL,
	`aggregate_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`occurred_at` text NOT NULL,
	`correlation_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `draft_mutations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`status` text NOT NULL,
	`revision_id` text,
	`current_revision_id` text
);
--> statement-breakpoint
CREATE TABLE `essay_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`revision_no` integer NOT NULL,
	`plain_text` text NOT NULL,
	`content_json` text NOT NULL,
	`word_count` integer NOT NULL,
	`text_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `essay_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`status` text NOT NULL,
	`current_revision_id` text NOT NULL,
	`started_at` text NOT NULL,
	`submitted_at` text,
	`timer_elapsed_ms` integer NOT NULL,
	`timer_running_since` text,
	`client_request_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `essay_sessions_client_request_id_unique` ON `essay_sessions` (`client_request_id`);--> statement-breakpoint
CREATE TABLE `writing_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_text` text NOT NULL,
	`image_placeholder_kind` text NOT NULL
);
