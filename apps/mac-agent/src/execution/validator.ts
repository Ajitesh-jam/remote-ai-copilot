import type { ElementInfo, PrepareSnapshot } from "@remote-ai-copilot/shared-types";
import { summarizeFocused } from "../browser/context-extractor.js";

export interface ValidationResult {
  ok: boolean;
  warning?: string;
}

export function validateTypingTarget(
  snapshot: PrepareSnapshot,
  currentTabId: number,
  currentUrl: string,
  focused: ElementInfo | null
): ValidationResult {
  if (currentTabId !== snapshot.tabId) {
    return {
      ok: false,
      warning: [
        "WARNING:",
        "The active browser tab has changed.",
        "",
        `Prepared for tab ${snapshot.tabId}: ${snapshot.url}`,
        `Currently active tab ${currentTabId}: ${currentUrl}`,
        "",
        "Typing cancelled.",
      ].join("\n"),
    };
  }

  const currentFp = focused?.fingerprint ?? null;
  if (snapshot.focusedFingerprint && currentFp !== snapshot.focusedFingerprint) {
    return {
      ok: false,
      warning: [
        "WARNING:",
        "The focused browser element has changed.",
        "",
        `Prepared for:`,
        snapshot.focusedSummary,
        "",
        `Currently focused:`,
        focused
          ? summarizeFocused({
              tagName: focused.tagName ?? focused.tag,
              type: focused.type,
              placeholder: focused.placeholder,
              ariaLabel: focused.ariaLabel,
              value: focused.value,
              fingerprint: focused.fingerprint,
            })
          : "none (or Chrome address bar / non-editable)",
        "",
        "Typing cancelled.",
      ].join("\n"),
    };
  }

  if (!focused) {
    return {
      ok: false,
      warning: "WARNING:\nNo focused editable element.\n\nTyping cancelled.",
    };
  }

  if (focused.type === "password") {
    return {
      ok: false,
      warning: "WARNING:\nRefusing to type into a password field.\n\nTyping cancelled.",
    };
  }

  const editable =
    focused.tag === "textarea" ||
    focused.tag === "input" ||
    focused.tagName === "textarea" ||
    focused.tagName === "input" ||
    (focused.fingerprint ?? "").includes("contenteditable") ||
    focused.role === "textbox";

  if (!editable) {
    return {
      ok: false,
      warning: `WARNING:\nFocused element is not editable (${focused.tag}).\n\nTyping cancelled.`,
    };
  }

  return { ok: true };
}
