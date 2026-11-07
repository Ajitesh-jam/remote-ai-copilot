import type { DraftResult, PageContext } from "@remote-ai-copilot/shared-types";

export interface DraftProvider {
  generateDraft(input: {
    instruction: string;
    context: PageContext;
    signal?: AbortSignal;
  }): Promise<DraftResult>;
}

export class StubDraftProvider implements DraftProvider {
  async generateDraft(input: {
    instruction: string;
    context: PageContext;
    signal?: AbortSignal;
  }): Promise<DraftResult> {
    if (input.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const { context, instruction } = input;
    const selection = context.selection.trim();
    const focus = context.focusedElement;
    const focusHint = focus
      ? `${focus.tagName}${focus.placeholder ? ` (${focus.placeholder})` : ""}`
      : "no focused input";

    const draft = [
      `[Stub draft]`,
      `Page: ${context.tab.title || context.tab.url}`,
      instruction ? `Instruction: ${instruction}` : null,
      selection ? `Re: "${selection.slice(0, 200)}"` : null,
      ``,
      `Hello,`,
      ``,
      `Based on the current page (${context.tab.url}) and focused field (${focusHint}), here is a prepared response.`,
      ``,
      `Please review before sending.`,
      ``,
      `Best regards`,
    ]
      .filter((line) => line !== null)
      .join("\n");

    return {
      draft,
      explanation: "StubDraftProvider generated a deterministic draft from page metadata.",
      target: {
        type: focus?.tagName ?? "unknown",
        purpose: "reply",
      },
    };
  }
}

export class HttpDraftProvider implements DraftProvider {
  constructor(private readonly endpoint: string) {}

  async generateDraft(input: {
    instruction: string;
    context: PageContext;
    signal?: AbortSignal;
  }): Promise<DraftResult> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instruction: input.instruction,
        context: input.context,
      }),
      signal: input.signal,
    });
    if (!res.ok) {
      throw new Error(`Draft HTTP provider failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as DraftResult;
    if (typeof data.draft !== "string" || !data.draft.trim()) {
      throw new Error("Draft HTTP provider returned invalid draft");
    }
    return data;
  }
}
