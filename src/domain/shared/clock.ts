export interface Clock {
  now(): Date;
}

export interface ScheduledTask {
  readonly id: string;
}

export interface Scheduler {
  schedule(delayMs: number, callback: () => void): ScheduledTask;
  cancel(task: ScheduledTask): void;
}
