export interface JobRequest {
  name: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface JobHandle { id: string }
export interface JobStatus { state: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED"; result?: unknown }

export interface JobPort {
  enqueue(request: JobRequest): JobHandle;
  cancel(id: string): void;
  status(id: string): JobStatus | undefined;
}
