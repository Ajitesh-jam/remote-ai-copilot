import type { AgentState } from "@remote-ai-copilot/shared-types";
import type { ComponentLogger } from "@remote-ai-copilot/logger";

const ALLOWED: Record<AgentState, AgentState[]> = {
  DISCONNECTED: ["IDLE", "ERROR", "HALTED"],
  IDLE: ["CAPTURING_CONTEXT", "HALTED", "DISCONNECTED", "ERROR"],
  CAPTURING_CONTEXT: [
    "SENDING_TO_LLM",
    "GENERATING_DRAFT",
    "HALTED",
    "ERROR",
    "IDLE",
  ],
  SENDING_TO_LLM: ["GENERATING_DRAFT", "HALTED", "ERROR", "IDLE"],
  GENERATING_DRAFT: ["DRAFT_READY", "HALTED", "ERROR", "IDLE"],
  DRAFT_READY: ["VALIDATING", "CAPTURING_CONTEXT", "HALTED", "IDLE", "ERROR"],
  VALIDATING: ["TYPING", "DRAFT_READY", "HALTED", "ERROR", "IDLE"],
  TYPING: ["COMPLETED", "HALTED", "ERROR"],
  COMPLETED: ["IDLE", "CAPTURING_CONTEXT", "HALTED", "DISCONNECTED"],
  HALTED: ["IDLE", "CAPTURING_CONTEXT", "VALIDATING", "TYPING", "DISCONNECTED"],
  ERROR: ["IDLE", "CAPTURING_CONTEXT", "HALTED", "DISCONNECTED"],
};

export class AgentStateMachine {
  private state: AgentState = "DISCONNECTED";

  constructor(private readonly logger: ComponentLogger) {}

  getState(): AgentState {
    return this.state;
  }

  canTransition(to: AgentState): boolean {
    if (to === "HALTED") return true;
    return ALLOWED[this.state]?.includes(to) ?? false;
  }

  transition(to: AgentState, reason?: string): boolean {
    if (to === this.state) return true;
    if (to !== "HALTED" && !this.canTransition(to)) {
      this.logger.warn("Illegal state transition", {
        from: this.state,
        to,
        reason: reason ?? null,
      });
      return false;
    }
    const from = this.state;
    this.state = to;
    this.logger.info(`STATE=${to}`, { from, to, reason: reason ?? null });
    return true;
  }

  force(to: AgentState, reason?: string): void {
    const from = this.state;
    this.state = to;
    this.logger.info(`STATE=${to}`, { from, to, reason: reason ?? "forced" });
  }

  /** States from which a new PREPARE may start */
  canPrepare(): boolean {
    return (
      this.state === "IDLE" ||
      this.state === "DRAFT_READY" ||
      this.state === "COMPLETED" ||
      this.state === "HALTED" ||
      this.state === "ERROR"
    );
  }

  canGo(): boolean {
    return this.state === "DRAFT_READY";
  }

  canResume(): boolean {
    return this.state === "HALTED";
  }
}

export { ALLOWED as STATE_TRANSITIONS };
