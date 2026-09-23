import { describe, expect, it } from "vitest";

import { transitionTaskIntake } from "../../src/domain/task-context/task-intake-state-machine";

describe("task intake state machine", () => {
  it("allows only the upload to processing lifecycle", () => {
    expect(transitionTaskIntake("UPLOADED", "QUEUE")).toBe("QUEUED");
    expect(transitionTaskIntake("QUEUED", "START_PROCESSING")).toBe("PROCESSING");
    expect(transitionTaskIntake("PROCESSING", "PUBLISH_READY")).toBe("READY");
    expect(transitionTaskIntake("PROCESSING", "PUBLISH_DEGRADED")).toBe("DEGRADED");
    expect(transitionTaskIntake("PROCESSING", "FAIL")).toBe("FAILED");
  });

  it.each(["READY", "DEGRADED", "FAILED"] as const)("does not let a late result overwrite %s", (status) => {
    expect(() => transitionTaskIntake(status, "PUBLISH_READY")).toThrow("INVALID_TASK_INTAKE_TRANSITION");
    expect(() => transitionTaskIntake(status, "FAIL")).toThrow("INVALID_TASK_INTAKE_TRANSITION");
  });

  it("rejects skipped and backward transitions", () => {
    expect(() => transitionTaskIntake("UPLOADED", "START_PROCESSING")).toThrow("INVALID_TASK_INTAKE_TRANSITION");
    expect(() => transitionTaskIntake("PROCESSING", "QUEUE")).toThrow("INVALID_TASK_INTAKE_TRANSITION");
  });
});
