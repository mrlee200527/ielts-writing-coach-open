import type { JobHandle, JobPort, JobRequest, JobStatus } from "../ports/job.port";

export class ControlledJobFake implements JobPort {
  enqueueCount = 0;
  failNextEnqueue = false;
  private sequence = 0;
  private readonly idByKey = new Map<string, string>();
  private readonly statuses = new Map<string, JobStatus>();

  enqueue(request: JobRequest): JobHandle {
    const existing = this.idByKey.get(request.idempotencyKey);
    if (existing) return { id: existing };
    this.enqueueCount += 1;
    if (this.failNextEnqueue) {
      this.failNextEnqueue = false;
      throw new Error("JOB_ENQUEUE_FAILED");
    }
    const id = `job-${++this.sequence}`;
    this.idByKey.set(request.idempotencyKey, id);
    this.statuses.set(id, { state: "QUEUED" });
    return { id };
  }

  cancel(id: string): void {
    const status = this.statuses.get(id);
    if (status?.state === "QUEUED" || status?.state === "RUNNING") this.statuses.set(id, { state: "CANCELLED" });
  }
  status(id: string): JobStatus | undefined { return this.statuses.get(id); }
  start(id: string): void {
    if (this.statuses.get(id)?.state === "QUEUED") this.statuses.set(id, { state: "RUNNING" });
  }
  complete(id: string, result: unknown): void {
    if (this.statuses.get(id)?.state === "RUNNING") this.statuses.set(id, { state: "COMPLETED", result: structuredClone(result) });
  }
  fail(id: string): void {
    if (this.statuses.get(id)?.state === "RUNNING") this.statuses.set(id, { state: "FAILED" });
  }
}
