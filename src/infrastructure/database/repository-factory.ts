import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createLocalDatabase } from "./client";
import { DrizzleEssaySessionRepository } from "../storage/drizzle-essay-session.repository";
import { DrizzleTaskIntakeRepository } from "../storage/drizzle-task-intake.repository";
import { LocalFilesystemBlobAdapter } from "../blob/local-filesystem-blob.adapter";
import { LocalTaskContextJobAdapter } from "../jobs/local-task-context-job.adapter";
import { loadMiMoConfig } from "../llm/mimo-config";
import { MiMoClient } from "../llm/mimo-client";
import { MiMoTaskContextAdapter } from "../llm/mimo-task-context.adapter";
import { processTaskContext } from "../../application/task-intake/process-task-context";

let repository: DrizzleEssaySessionRepository | undefined;
let taskIntakeRepository: DrizzleTaskIntakeRepository | undefined;
let taskContextJobs: LocalTaskContextJobAdapter | undefined;
export function getEssaySessionRepository() {
  if (repository) return repository;
  const path = process.env.LOCAL_DATABASE_PATH ?? ".data/local.sqlite";
  mkdirSync(dirname(path), { recursive: true });
  repository = new DrizzleEssaySessionRepository(createLocalDatabase(path));
  return repository;
}

export function getTaskIntakeRepository() {
  if (taskIntakeRepository) return taskIntakeRepository;
  const path = process.env.LOCAL_DATABASE_PATH ?? ".data/local.sqlite";
  mkdirSync(dirname(path), { recursive: true });
  taskIntakeRepository = new DrizzleTaskIntakeRepository(createLocalDatabase(path));
  return taskIntakeRepository;
}

export function getTaskImageBlobAdapter() {
  return new LocalFilesystemBlobAdapter(process.env.LOCAL_BLOB_ROOT ?? ".data/blobs");
}

export function getTaskContextJobAdapter() {
  if (!taskContextJobs) taskContextJobs = new LocalTaskContextJobAdapter(async (payload) => {
    const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
    const attemptId = typeof payload.attemptId === "string" ? payload.attemptId : undefined;
    if (!taskId || !attemptId) throw new Error("INVALID_TASK_CONTEXT_JOB");
    const config = loadMiMoConfig();
    await processTaskContext(
      {
        repository: getTaskIntakeRepository(),
        blobs: getTaskImageBlobAdapter(),
        llm: new MiMoTaskContextAdapter(new MiMoClient(config), config.model),
      },
      { taskId, attemptId, now: new Date() },
    );
  }, true);
  return taskContextJobs;
}
