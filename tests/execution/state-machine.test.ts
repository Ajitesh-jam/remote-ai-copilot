import { describe, expect, it, vi } from "vitest";
import { AgentStateMachine } from "../../apps/mac-agent/src/agent-state.js";
import type { ComponentLogger } from "@remote-ai-copilot/logger";

function mockLogger(): ComponentLogger {
  return {
    event: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("AgentStateMachine", () => {
  it("allows PREPARE path IDLE → CAPTURING → … → DRAFT_READY", () => {
    const sm = new AgentStateMachine(mockLogger());
    sm.force("IDLE");
    expect(sm.transition("CAPTURING_CONTEXT")).toBe(true);
    expect(sm.transition("SENDING_TO_LLM")).toBe(true);
    expect(sm.transition("GENERATING_DRAFT")).toBe(true);
    expect(sm.transition("DRAFT_READY")).toBe(true);
    expect(sm.getState()).toBe("DRAFT_READY");
  });

  it("rejects automatic DRAFT_READY → TYPING", () => {
    const sm = new AgentStateMachine(mockLogger());
    sm.force("DRAFT_READY");
    expect(sm.transition("TYPING")).toBe(false);
    expect(sm.getState()).toBe("DRAFT_READY");
  });

  it("allows GO path DRAFT_READY → VALIDATING → TYPING → COMPLETED", () => {
    const sm = new AgentStateMachine(mockLogger());
    sm.force("DRAFT_READY");
    expect(sm.canGo()).toBe(true);
    expect(sm.transition("VALIDATING")).toBe(true);
    expect(sm.transition("TYPING")).toBe(true);
    expect(sm.transition("COMPLETED")).toBe(true);
  });

  it("HALT is allowed from any state", () => {
    const sm = new AgentStateMachine(mockLogger());
    sm.force("TYPING");
    expect(sm.transition("HALTED")).toBe(true);
    expect(sm.getState()).toBe("HALTED");
  });

  it("canPrepare from HALTED and DRAFT_READY", () => {
    const sm = new AgentStateMachine(mockLogger());
    sm.force("HALTED");
    expect(sm.canPrepare()).toBe(true);
    sm.force("DRAFT_READY");
    expect(sm.canPrepare()).toBe(true);
    sm.force("TYPING");
    expect(sm.canPrepare()).toBe(false);
  });
});
