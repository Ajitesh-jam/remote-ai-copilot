import { randomUUID } from "node:crypto";
import type {
  DraftResult,
  PageContext,
  PrepareSnapshot,
} from "@remote-ai-copilot/shared-types";
import type { ComponentLogger } from "@remote-ai-copilot/logger";
import type { BrowserAdapter } from "../browser/adapter.js";
import { summarizeFocused } from "../browser/context-extractor.js";
import type { DraftProvider } from "../draft/provider.js";
import type { AgentStateMachine } from "../agent-state.js";
import type { ExecutionController } from "./halt.js";

export interface PrepareResult {
  taskId: string;
  context: PageContext;
  draft: DraftResult;
  snapshot: PrepareSnapshot;
  resolvedInstruction: string;
}

/** Prefer explicit instruction, then selection, then focused field value. */
export function resolveInstruction(
  explicit: string | undefined,
  context: PageContext
): string {
  if (explicit?.trim()) return explicit.trim();
  if (context.selection.trim()) return context.selection.trim();
  const focusedValue = context.focusedElement?.value?.trim();
  if (focusedValue) return focusedValue;
  return "Generate an appropriate response for the focused input based on the page context.";
}

export async function runPrepare(opts: {
  browser: BrowserAdapter;
  draftProvider: DraftProvider;
  state: AgentStateMachine;
  execution: ExecutionController;
  logger: ComponentLogger;
  instruction?: string;
}): Promise<PrepareResult> {
  const { browser, draftProvider, state, execution, logger } = opts;

  if (!browser.isConnected()) {
    throw new Error("Browser not connected");
  }
  if (!state.canPrepare()) {
    throw new Error(`Cannot PREPARE from state ${state.getState()}`);
  }

  const { signal, taskGeneration } = execution.begin();
  const taskId = randomUUID();

  state.transition("CAPTURING_CONTEXT", "PREPARE");
  logger.event("HOTKEY_PREPARE", "STARTED", { taskId });

  try {
    const context = await browser.getPageContext();
    if (signal.aborted || !execution.isCurrent(taskGeneration)) {
      state.force("HALTED", "aborted during capture");
      throw new DOMException("Aborted", "AbortError");
    }

    const resolvedInstruction = resolveInstruction(opts.instruction, context);

    const snapshot: PrepareSnapshot = {
      tabId: context.tab.id,
      url: context.tab.url,
      title: context.tab.title,
      focusedFingerprint: context.focusedElement?.fingerprint ?? null,
      focusedSummary: summarizeFocused(context.focusedElement),
      capturedAt: context.timestamp,
    };

    state.transition("SENDING_TO_LLM", "context captured");
    logger.event("CONTEXT_SENT_TO_SERVER", "SUCCESS", {
      taskId,
      details: {
        tabId: context.tab.id,
        url: context.tab.url,
        textLength: context.visibleText.length,
        instructionLength: resolvedInstruction.length,
      },
    });

    state.transition("GENERATING_DRAFT", "llm request");
    logger.event("LLM_REQUEST_STARTED", "STARTED", {
      taskId,
      details: { instructionPreview: resolvedInstruction.slice(0, 120) },
    });

    const draft = await draftProvider.generateDraft({
      instruction: resolvedInstruction,
      context,
      signal,
    });

    if (signal.aborted || !execution.isCurrent(taskGeneration)) {
      state.force("HALTED", "late draft ignored");
      logger.event("LLM_REQUEST_SUCCESS", "CANCELLED", {
        taskId,
        details: { reason: "generation superseded or halted" },
      });
      throw new DOMException("Aborted", "AbortError");
    }

    if (typeof draft.draft !== "string" || !draft.draft.trim()) {
      throw new Error("LLM returned empty draft");
    }

    logger.event("LLM_REQUEST_SUCCESS", "SUCCESS", {
      taskId,
      details: { draftLength: draft.draft.length },
    });
    logger.event("LLM_RESPONSE_VALIDATED", "SUCCESS", { taskId });
    logger.event("DRAFT_STORED", "SUCCESS", {
      taskId,
      details: { draftLength: draft.draft.length },
    });

    state.transition("DRAFT_READY", "draft stored");

    return { taskId, context, draft, snapshot, resolvedInstruction };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    state.transition("ERROR", "prepare failed");
    logger.event("LLM_REQUEST_FAILED", "FAILED", {
      taskId,
      error: { message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
