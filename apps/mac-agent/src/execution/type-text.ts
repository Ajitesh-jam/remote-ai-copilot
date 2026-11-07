import type { ComponentLogger } from "@remote-ai-copilot/logger";
import type { PrepareSnapshot } from "@remote-ai-copilot/shared-types";
import type { BrowserAdapter } from "../browser/adapter.js";
import type { AgentStateMachine } from "../agent-state.js";
import type { ExecutionController } from "./halt.js";
import { validateTypingTarget } from "./validator.js";

export interface GoResult {
  typed: boolean;
  warning?: string;
}

export async function runGo(opts: {
  browser: BrowserAdapter;
  state: AgentStateMachine;
  execution: ExecutionController;
  logger: ComponentLogger;
  draft: string;
  snapshot: PrepareSnapshot;
  allowAutomaticSubmission: boolean;
}): Promise<GoResult> {
  const { browser, state, execution, logger, draft, snapshot } = opts;

  if (opts.allowAutomaticSubmission) {
    throw new Error("Automatic submission is disabled in this build");
  }

  if (!state.canGo()) {
    throw new Error(`GO only valid when DRAFT_READY (current: ${state.getState()})`);
  }
  if (!browser.isConnected()) {
    throw new Error("Browser not connected");
  }
  if (!draft.trim()) {
    throw new Error("No prepared draft");
  }

  logger.event("GO_REQUESTED", "STARTED");
  logger.event("HOTKEY_GO", "STARTED");

  const { signal, taskGeneration } = execution.begin();
  state.transition("VALIDATING", "GO");
  logger.event("EXECUTION_VALIDATION_STARTED", "STARTED");

  try {
    const tab = await browser.getActiveTab();
    const focused = await browser.getFocusedElement();
    const validation = validateTypingTarget(snapshot, tab.id, tab.url, focused);

    if (!validation.ok) {
      state.transition("DRAFT_READY", "validation failed");
      logger.event("EXECUTION_VALIDATION_STARTED", "FAILED", {
        details: { warning: validation.warning },
      });
      return { typed: false, warning: validation.warning };
    }

    logger.event("EXECUTION_VALIDATION_SUCCESS", "SUCCESS", {
      details: { tabId: tab.id },
    });

    if (signal.aborted || !execution.isCurrent(taskGeneration)) {
      state.force("HALTED", "aborted before typing");
      return { typed: false, warning: "HALTED before typing" };
    }

    state.transition("TYPING", "validation ok");
    await browser.insertText(draft, signal);

    if (signal.aborted || !execution.isCurrent(taskGeneration)) {
      state.force("HALTED", "halted during typing");
      logger.event("TYPING_CANCELLED", "CANCELLED");
      return { typed: false, warning: "HALTED during typing" };
    }

    state.transition("COMPLETED", "typing finished");
    return { typed: true };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      state.force("HALTED", "abort during go");
      logger.event("TYPING_CANCELLED", "CANCELLED");
      return { typed: false, warning: "HALTED" };
    }
    state.transition("ERROR", "go failed");
    logger.event("TYPING_STARTED", "FAILED", {
      error: { message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
