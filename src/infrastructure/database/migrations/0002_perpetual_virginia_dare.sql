CREATE TABLE `task_context_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`prompt_version` text NOT NULL,
	`schema_version` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`state` text NOT NULL,
	`call_count` integer NOT NULL,
	`job_id` text,
	`failure_code` text,
	`started_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_context_attempts_task_idempotency_unique` ON `task_context_attempts` (`task_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `task_context_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`context_json` text,
	`limitations_json` text NOT NULL,
	`source_image_sha256` text NOT NULL,
	`prompt_version` text NOT NULL,
	`schema_version` integer NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_context_versions_task_version_unique` ON `task_context_versions` (`task_id`,`version`);--> statement-breakpoint
ALTER TABLE `writing_tasks` ADD `image_blob_id` text;--> statement-breakpoint
ALTER TABLE `writing_tasks` ADD `image_media_type` text;--> statement-breakpoint
ALTER TABLE `writing_tasks` ADD `image_sha256` text;--> statement-breakpoint
ALTER TABLE `writing_tasks` ADD `intake_status` text;--> statement-breakpoint
ALTER TABLE `writing_tasks` ADD `active_attempt_id` text;--> statement-breakpoint
ALTER TABLE `writing_tasks` ADD `current_task_context_version_id` text;