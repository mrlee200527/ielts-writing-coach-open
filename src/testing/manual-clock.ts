import type { Clock } from "../domain/shared/clock";

export class ManualClock implements Clock {
  constructor(private currentMs = 0) {}
  now(): Date {
    return new Date(this.currentMs);
  }
  advanceBy(milliseconds: number): void {
    this.currentMs += milliseconds;
  }
}
