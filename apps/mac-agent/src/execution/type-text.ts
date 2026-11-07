import type { ComponentLogger } from "@remote-ai-copilot/logger";
import type { PrepareSnapshot } from "@remote-ai-copilot/shared-types";
import type { BrowserAdapter } from "../browser/adapter.js";
import type { AgentStateMachine } from "../agent-state.js";
import type { ExecutionController } from "./halt.js";
import { validateTypingTarget } from "./validator.js";

export interface GoResult {
  typed: boolean;
  typedChars: number;
  remaining: string;
  warning?: string;
}

export async function runTyping(opts: {
  browser: BrowserAdapter;
  state: AgentStateMachine;
  execution: ExecutionController;
  logger: ComponentLogger;
  text: string;
  snapshot: PrepareSnapshot;
  replace: boolean;
  allowAutomaticSubmission: boolean;
  reason: "GO" | "RESUME";
  skipStateCheck?: boolean;
  onProgress?: (typedChars: number) => void;
}): Promise<GoResult> {
  const { browser, state, execution, logger, text, snapshot } = opts;

  if (opts.allowAutomaticSubmission) {
    throw new Error("Automatic submission is disabled in this build");
  }

  if (!opts.skipStateCheck) {
    if (opts.reason === "GO" && !state.canGo()) {
      throw new Error(`GO only valid when DRAFT_READY (current: ${state.getState()})`);
    }
    if (opts.reason === "RESUME" && !state.canResume()) {
      throw new Error(`RESUME only valid when HALTED (current: ${state.getState()})`);
    }
  }

  if (!browser.isConnected()) {
    throw new Error("Browser not connected");
  }
  if (!text.length) {
    throw new Error("Nothing left to type");
  }

  logger.event(opts.reason === "GO" ? "GO_REQUESTED" : "RESUME_REQUESTED", "STARTED");
  logger.event(opts.reason === "GO" ? "HOTKEY_GO" : "HOTKEY_RESUME", "STARTED");

  const { signal, taskGeneration } = execution.begin();
  state.transition("VALIDATING", opts.reason);
  logger.event("EXECUTION_VALIDATION_STARTED", "STARTED");

  let typedChars = 0;

  try {
    const tab = await browser.getActiveTab();
    const focused = await browser.getFocusedElement();
    const validation = validateTypingTarget(snapshot, tab.id, tab.url, focused);

    if (!validation.ok) {
      // Keep draft/resume available
      if (opts.reason === "GO") state.transition("DRAFT_READY", "validation failed");
      else state.force("HALTED", "validation failed on resume");
      logger.event("EXECUTION_VALIDATION_STARTED", "FAILED", {
        details: { warning: validation.warning },
      });
      return {
        typed: false,
        typedChars: 0,
        remaining: text,
        warning: validation.warning,
      };
    }

    logger.event("EXECUTION_VALIDATION_SUCCESS", "SUCCESS", {
      details: { tabId: tab.id },
    });

    if (signal.aborted || !execution.isCurrent(taskGeneration)) {
      state.force("HALTED", "aborted before typing");
      return { typed: false, typedChars: 0, remaining: text, warning: "HALTED before typing" };
    }

    state.transition("TYPING", "validation ok");
    await browser.insertText(text, signal, {
      replace: opts.replace,
      onProgress: (n) => {
        typedChars = n;
        opts.onProgress?.(n);
      },
    });

    if (signal.aborted || !execution.isCurrent(taskGeneration)) {
      const remaining = text.slice(typedChars);
      state.force("HALTED", "halted during typing");
      logger.event("TYPING_CANCELLED", "CANCELLED", {
        details: { typedChars, remainingLength: remaining.length },
      });
      return { typed: false, typedChars, remaining, warning: "HALTED during typing" };
    }

    state.transition("COMPLETED", "typing finished");
    return { typed: true, typedChars: text.length, remaining: "" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      const remaining = text.slice(typedChars);
      state.force("HALTED", "abort during typing");
      logger.event("TYPING_CANCELLED", "CANCELLED", {
        details: { typedChars, remainingLength: remaining.length },
      });
      return { typed: false, typedChars, remaining, warning: "HALTED" };
    }
    state.transition("ERROR", "typing failed");
    logger.event("TYPING_STARTED", "FAILED", {
      error: { message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

/** @deprecated use runTyping */
export async function runGo(opts: {
  browser: BrowserAdapter;
  state: AgentStateMachine;
  execution: ExecutionController;
  logger: ComponentLogger;
  draft: string;
  snapshot: PrepareSnapshot;
  allowAutomaticSubmission: boolean;
  replace?: boolean;
}): Promise<GoResult> {
  return runTyping({
    ...opts,
    text: opts.draft,
    replace: opts.replace ?? true,
    reason: "GO",
  });
}
