// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWritingTimer, type WritingTimerRuntime } from "../../src/presentation/writing/use-writing-timer";

describe("use writing timer", () => {
  it("uses the injected clock and interval runtime", () => {
    let now = new Date("2026-08-14T01:00:00.000Z");
    let tick: () => void = () => undefined;
    const runtime: WritingTimerRuntime = {
      now: () => now,
      setInterval: (callback) => { tick = callback; return "interval"; },
      clearInterval: () => undefined,
    };
    const { result } = renderHook(() => useWritingTimer({ elapsedMs: 0, runningSince: "2026-08-14T01:00:00.000Z" }, runtime));
    now = new Date("2026-08-14T01:00:02.000Z");
    act(() => tick());
    expect(result.current.elapsedMs).toBe(2000);
    act(() => result.current.pause());
    expect(result.current.timer).toEqual({ elapsedMs: 2000 });
  });
});
