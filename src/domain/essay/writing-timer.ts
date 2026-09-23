export interface WritingTimerSnapshot {
  elapsedMs: number;
  runningSince?: string;
}

export function elapsedWritingMs(snapshot: WritingTimerSnapshot, now: Date): number {
  if (!snapshot.runningSince) return snapshot.elapsedMs;
  return snapshot.elapsedMs + Math.max(0, now.getTime() - Date.parse(snapshot.runningSince));
}

export function pauseWritingTimer(snapshot: WritingTimerSnapshot, now: Date): WritingTimerSnapshot {
  return { elapsedMs: elapsedWritingMs(snapshot, now) };
}

export function resumeWritingTimer(snapshot: WritingTimerSnapshot, now: Date): WritingTimerSnapshot {
  if (snapshot.runningSince) return snapshot;
  return { elapsedMs: snapshot.elapsedMs, runningSince: now.toISOString() };
}

export function formatWritingTime(elapsedMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
