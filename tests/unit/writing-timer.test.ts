import { describe, expect, it } from "vitest";
import { elapsedWritingMs, formatWritingTime, pauseWritingTimer, resumeWritingTimer } from "../../src/domain/essay/writing-timer";

describe("writing timer", () => {
  it("calculates and formats elapsed time deterministically", () => {
    expect(elapsedWritingMs({ elapsedMs: 0, runningSince: "2026-08-14T01:00:00.000Z" }, new Date("2026-08-14T01:00:59.000Z"))).toBe(59000);
    expect(formatWritingTime(59000)).toBe("00:59");
    expect(formatWritingTime(60000)).toBe("01:00");
  });

  it("pauses, resumes, and ignores backwards clock movement", () => {
    const paused = pauseWritingTimer({ elapsedMs: 1000, runningSince: "2026-08-14T01:00:00.000Z" }, new Date("2026-08-14T01:00:02.000Z"));
    expect(paused).toEqual({ elapsedMs: 3000 });
    expect(elapsedWritingMs(paused, new Date("2026-08-14T02:00:00.000Z"))).toBe(3000);
    expect(resumeWritingTimer(paused, new Date("2026-08-14T02:00:00.000Z"))).toEqual({ elapsedMs: 3000, runningSince: "2026-08-14T02:00:00.000Z" });
    expect(elapsedWritingMs({ elapsedMs: 1000, runningSince: "2026-08-14T02:00:00.000Z" }, new Date("2026-08-14T01:00:00.000Z"))).toBe(1000);
  });
});
