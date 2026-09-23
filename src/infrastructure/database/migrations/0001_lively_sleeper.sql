PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_draft_mutations` (
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`status` text NOT NULL,
	`revision_id` text,
	`current_revision_id` text,
	PRIMARY KEY(`session_id`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_draft_mutations`("id", "session_id", "status", "revision_id", "current_revision_id") SELECT "id", "session_id", "status", "revision_id", "current_revision_id" FROM `draft_mutations`;--> statement-breakpoint
DROP TABLE `draft_mutations`;--> statement-breakpoint
ALTER TABLE `__new_draft_mutations` RENAME TO `draft_mutations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `domain_events` ADD `aggregate_type` text NOT NULL DEFAULT 'essay_session';--> statement-breakpoint
CREATE UNIQUE INDEX `essay_revisions_session_revision_no_unique` ON `essay_revisions` (`session_id`,`revision_no`);
