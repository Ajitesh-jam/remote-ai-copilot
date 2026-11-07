import { describe, expect, it } from "vitest";
import { ExecutionController } from "../../apps/mac-agent/src/execution/halt.js";

describe("ExecutionController", () => {
  it("aborts active signal on halt", () => {
    const exec = new ExecutionController();
    const { signal, taskGeneration } = exec.begin();
    expect(signal.aborted).toBe(false);
    expect(exec.isCurrent(taskGeneration)).toBe(true);
    exec.halt();
    expect(signal.aborted).toBe(true);
  });

  it("supersedes previous generation on begin", () => {
    const exec = new ExecutionController();
    const first = exec.begin();
    const second = exec.begin();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(exec.isCurrent(first.taskGeneration)).toBe(false);
    expect(exec.isCurrent(second.taskGeneration)).toBe(true);
  });
});
