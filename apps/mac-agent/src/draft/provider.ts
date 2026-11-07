import type { DraftResult, PageContext } from "@remote-ai-copilot/shared-types";

export interface DraftProvider {
  generateDraft(input: {
    instruction: string;
    context: PageContext;
    signal?: AbortSignal;
  }): Promise<DraftResult>;
}

function looksLikeCodeRequest(instruction: string): boolean {
  const t = instruction.toLowerCase();
  return (
    t.includes("code") ||
    t.includes("python") ||
    t.includes("javascript") ||
    t.includes("script") ||
    t.includes("function") ||
    t.includes("write me") ||
    t.includes("print")
  );
}

function stubCodeFor(instruction: string): string | null {
  const t = instruction.toLowerCase();
  if (t.includes("python") && (t.includes("hello") || t.includes("print"))) {
    return [
      '"""Simple Hello World script."""',
      "",
      "def main() -> None:",
      '    message = "Hello, World!"',
      "    print(message)",
      "",
      "",
      'if __name__ == "__main__":',
      "    main()",
      "",
    ].join("\n");
  }
  if (t.includes("javascript") && (t.includes("hello") || t.includes("print") || t.includes("console"))) {
    return [
      "function main() {",
      '  const message = "Hello, World!";',
      "  console.log(message);",
      "}",
      "",
      "main();",
      "",
    ].join("\n");
  }
  if (t.includes("hello world") || (t.includes("hello") && t.includes("print"))) {
    return [
      '"""Simple Hello World script."""',
      "",
      "def main() -> None:",
      '    print("Hello, World!")',
      "",
      "",
      'if __name__ == "__main__":',
      "    main()",
      "",
    ].join("\n");
  }
  return null;
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
    const focus = context.focusedElement;

    const code = stubCodeFor(instruction);
    if (code) {
      return {
        draft: code,
        explanation: `Stub generated code for instruction: ${instruction.slice(0, 120)}`,
        target: {
          type: focus?.tagName ?? "textarea",
          purpose: "code",
        },
      };
    }

    if (looksLikeCodeRequest(instruction)) {
      return {
        draft: [
          `# Response to: ${instruction.slice(0, 120)}`,
          ``,
          `def main():`,
          `    print("Hello from stub draft")`,
          ``,
          `if __name__ == "__main__":`,
          `    main()`,
          ``,
        ].join("\n"),
        explanation: "Stub generated a generic code draft from the prompt in the focused field.",
        target: { type: focus?.tagName ?? "textarea", purpose: "code" },
      };
    }

    const selection = context.selection.trim();
    const focusHint = focus
      ? `${focus.tagName}${focus.placeholder ? ` (${focus.placeholder})` : ""}`
      : "no focused input";

    const draft = [
      `Hello,`,
      ``,
      `Regarding: ${instruction.slice(0, 240) || "(no instruction)"}`,
      selection ? `Selection: "${selection.slice(0, 200)}"` : null,
      ``,
      `Based on ${context.tab.title || context.tab.url} (${focusHint}), here is a prepared reply.`,
      ``,
      `Best regards`,
    ]
      .filter((line) => line !== null)
      .join("\n");

    return {
      draft,
      explanation: "StubDraftProvider generated a reply from the browser prompt/context.",
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
