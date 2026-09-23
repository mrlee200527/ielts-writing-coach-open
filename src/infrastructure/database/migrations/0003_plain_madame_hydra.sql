CREATE TABLE `ai_model_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`model_id` text NOT NULL,
	`role` text NOT NULL,
	`state` text NOT NULL,
	`verification_fingerprint` text NOT NULL,
	`endpoint_check` text NOT NULL,
	`credential_check` text NOT NULL,
	`model_access_check` text NOT NULL,
	`text_input_check` text NOT NULL,
	`image_input_check` text NOT NULL,
	`structured_output_check` text NOT NULL,
	`task_context_schema_check` text NOT NULL,
	`essay_feedback_schema_check` text NOT NULL,
	`last_probe_request_id` text,
	`failure_code` text,
	`verified_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_model_verifications_binding_unique` ON `ai_model_verifications` (`connection_id`,`model_id`,`role`);--> statement-breakpoint
CREATE TABLE `ai_probe_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`operation` text NOT NULL,
	`operation_fingerprint` text NOT NULL,
	`provider_kind` text NOT NULL,
	`connection_id` text NOT NULL,
	`config_revision` integer NOT NULL,
	`normalized_endpoint` text NOT NULL,
	`secret_revision` integer NOT NULL,
	`secret_ref` text NOT NULL,
	`model_id` text NOT NULL,
	`role` text,
	`state` text NOT NULL,
	`lease_expires_at` text,
	`stable_result_code` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_probe_requests_request_id_unique` ON `ai_probe_requests` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_probe_requests_one_live_claim_unique` ON `ai_probe_requests` (`operation_fingerprint`) WHERE "ai_probe_requests"."state" = 'CLAIMED';--> statement-breakpoint
CREATE TABLE `ai_provider_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_kind` text NOT NULL,
	`normalized_base_url` text NOT NULL,
	`model_id` text,
	`secret_ref` text NOT NULL,
	`secret_revision` integer NOT NULL,
	`config_revision` integer NOT NULL,
	`connection_test_state` text NOT NULL,
	`connection_tested_at` text,
	`connection_test_failure_code` text,
	`credential_cleanup_state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_provider_connections_provider_kind_unique` ON `ai_provider_connections` (`provider_kind`);--> statement-breakpoint
CREATE TABLE `ai_role_selections` (
	`role` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`model_id` text NOT NULL,
	`verification_id` text NOT NULL,
	`last_successful_snapshot_json` text,
	`last_successful_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `task_context_attempts` ADD `provider_kind` text;--> statement-breakpoint
ALTER TABLE `task_context_attempts` ADD `connection_id` text;--> statement-breakpoint
ALTER TABLE `task_context_attempts` ADD `config_revision` integer;--> statement-breakpoint
ALTER TABLE `task_context_attempts` ADD `normalized_endpoint` text;--> statement-breakpoint
ALTER TABLE `task_context_attempts` ADD `secret_revision` integer;--> statement-breakpoint
ALTER TABLE `task_context_attempts` ADD `secret_ref` text;--> statement-breakpoint
ALTER TABLE `task_context_attempts` ADD `requested_model_id` text;--> statement-breakpoint
ALTER TABLE `task_context_attempts` ADD `verification_id` text;--> statement-breakpoint
ALTER TABLE `task_context_attempts` ADD `verification_fingerprint` text;--> statement-breakpoint
ALTER TABLE `task_context_attempts` ADD `adapter_contract_version` text;--> statement-breakpoint
ALTER TABLE `task_context_attempts` ADD `invocation_fingerprint` text;--> statement-breakpoint
ALTER TABLE `task_context_versions` ADD `source_attempt_id` text;--> statement-breakpoint
ALTER TABLE `task_context_versions` ADD `provider_kind` text;--> statement-breakpoint
ALTER TABLE `task_context_versions` ADD `connection_id` text;--> statement-breakpoint
ALTER TABLE `task_context_versions` ADD `config_revision` integer;--> statement-breakpoint
ALTER TABLE `task_context_versions` ADD `normalized_endpoint` text;--> statement-breakpoint
ALTER TABLE `task_context_versions` ADD `secret_revision` integer;--> statement-breakpoint
ALTER TABLE `task_context_versions` ADD `requested_model_id` text;--> statement-breakpoint
ALTER TABLE `task_context_versions` ADD `verification_id` text;--> statement-breakpoint
ALTER TABLE `task_context_versions` ADD `verification_fingerprint` text;--> statement-breakpoint
ALTER TABLE `task_context_versions` ADD `adapter_contract_version` text;--> statement-breakpoint
ALTER TABLE `task_context_versions` ADD `invocation_fingerprint` text;