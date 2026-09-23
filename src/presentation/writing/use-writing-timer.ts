"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { elapsedWritingMs, pauseWritingTimer, resumeWritingTimer, type WritingTimerSnapshot } from "../../domain/essay/writing-timer";

export interface WritingTimerRuntime {
  now(): Date;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

const browserRuntime: WritingTimerRuntime = {
  now: () => new Date(),
  setInterval: (callback, delayMs) => window.setInterval(callback, delayMs),
  clearInterval: (handle) => window.clearInterval(handle as number),
};

export function useWritingTimer(snapshot: WritingTimerSnapshot, runtime: WritingTimerRuntime = browserRuntime) {
  const [timer, setTimer] = useState(snapshot);
  const [elapsed, setElapsed] = useState(snapshot.elapsedMs);
  const timerRef = useRef(snapshot);
  const replaceTimer = useCallback((next: WritingTimerSnapshot) => {
    timerRef.current = next;
    setTimer(next);
    setElapsed(elapsedWritingMs(next, runtime.now()));
    return next;
  }, [runtime]);
  useEffect(() => {
    const update = () => setElapsed(elapsedWritingMs(timerRef.current, runtime.now()));
    update();
    const id = runtime.setInterval(update, 1000);
    return () => runtime.clearInterval(id);
  }, [runtime]);
  const pause = useCallback(() => replaceTimer(pauseWritingTimer(timerRef.current, runtime.now())), [replaceTimer, runtime]);
  const resume = useCallback(() => replaceTimer(resumeWritingTimer(timerRef.current, runtime.now())), [replaceTimer, runtime]);
  return { elapsedMs: elapsed, timer, pause, resume };
}
