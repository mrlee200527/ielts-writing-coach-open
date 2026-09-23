import type { ScheduledTask, Scheduler } from "../domain/shared/clock";
import { ManualClock } from "./manual-clock";

interface PendingTask extends ScheduledTask {
  dueAt: number;
  callback: () => void;
  cancelled: boolean;
}

export class ManualScheduler implements Scheduler {
  private sequence = 0;
  private readonly tasks: PendingTask[] = [];

  constructor(private readonly clock: ManualClock) {}

  schedule(delayMs: number, callback: () => void): ScheduledTask {
    const task = { id: `scheduled-${++this.sequence}`, dueAt: this.clock.now().getTime() + delayMs, callback, cancelled: false };
    this.tasks.push(task);
    return task;
  }

  cancel(task: ScheduledTask): void {
    const pending = this.tasks.find((item) => item.id === task.id);
    if (pending) pending.cancelled = true;
  }

  advanceBy(milliseconds: number): void {
    this.clock.advanceBy(milliseconds);
    const now = this.clock.now().getTime();
    for (const task of this.tasks.filter((item) => !item.cancelled && item.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt)) {
      task.cancelled = true;
      task.callback();
    }
  }
}
