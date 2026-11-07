import type { Page } from "playwright";
import type { ElementInfo, PageContext, TabInfo } from "@remote-ai-copilot/shared-types";

const EXTRACTION_SCRIPT = `
(() => {
  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function fingerprint(el) {
    if (!el) return null;
    const parts = [
      el.tagName?.toLowerCase() ?? "",
      el.getAttribute("type") ?? "",
      el.getAttribute("id") ?? "",
      el.getAttribute("name") ?? "",
      el.getAttribute("placeholder") ?? "",
      el.getAttribute("aria-label") ?? "",
      el.getAttribute("role") ?? "",
      el.isContentEditable ? "contenteditable" : "",
    ];
    return parts.join("|");
  }

  function focusedInfo() {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    const tagName = el.tagName.toLowerCase();
    const type = el.getAttribute("type") ?? undefined;
    if (type === "password") {
      return {
        tagName,
        type: "password",
        placeholder: undefined,
        ariaLabel: el.getAttribute("aria-label") ?? undefined,
        value: undefined,
        fingerprint: fingerprint(el),
      };
    }
    return {
      tagName,
      type,
      placeholder: el.getAttribute("placeholder") ?? undefined,
      ariaLabel: el.getAttribute("aria-label") ?? undefined,
      value: el.isContentEditable
        ? (el.textContent ?? "").slice(0, 200)
        : typeof el.value === "string"
          ? el.value.slice(0, 200)
          : undefined,
      fingerprint: fingerprint(el),
    };
  }

  function visibleText() {
    const clone = document.body ? document.body.cloneNode(true) : null;
    if (!clone) return "";
    clone.querySelectorAll("script,style,noscript,svg").forEach((n) => n.remove());
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts = [];
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || !isVisible(parent)) continue;
      const text = (node.textContent ?? "").replace(/\\s+/g, " ").trim();
      if (text) parts.push(text);
    }
    return parts.join("\\n");
  }

  function interactive() {
    const selectors = [
      "a[href]",
      "button",
      "input:not([type=hidden]):not([type=password])",
      "textarea",
      "select",
      "[contenteditable=true]",
      "[role=button]",
      "[role=textbox]",
      "[role=link]",
    ];
    const seen = new Set();
    const results = [];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (!isVisible(el) || seen.has(el)) continue;
        seen.add(el);
        results.push({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") ?? undefined,
          text: (el.innerText || el.textContent || "").trim().slice(0, 120) || undefined,
          ariaLabel: el.getAttribute("aria-label") ?? undefined,
          placeholder: el.getAttribute("placeholder") ?? undefined,
          selector: el.id ? "#" + CSS.escape(el.id) : undefined,
        });
        if (results.length >= 80) return results;
      }
    }
    return results;
  }

  return {
    selection: window.getSelection()?.toString() ?? "",
    visibleText: visibleText(),
    focusedElement: focusedInfo(),
    interactiveElements: interactive(),
  };
})()
`;

export interface ExtractionOptions {
  maxVisibleTextChars: number;
  includeScreenshot: boolean;
}

export async function extractPageContext(
  page: Page,
  tab: TabInfo,
  options: ExtractionOptions
): Promise<PageContext> {
  const raw = (await page.evaluate(EXTRACTION_SCRIPT)) as {
    selection: string;
    visibleText: string;
    focusedElement: PageContext["focusedElement"];
    interactiveElements: PageContext["interactiveElements"];
  };

  let visibleText = raw.visibleText ?? "";
  if (visibleText.length > options.maxVisibleTextChars) {
    visibleText =
      visibleText.slice(0, options.maxVisibleTextChars) +
      `\n…[truncated ${visibleText.length - options.maxVisibleTextChars} chars]`;
  }

  let screenshot: string | undefined;
  if (options.includeScreenshot) {
    const buf = await page.screenshot({ type: "png", fullPage: false });
    screenshot = buf.toString("base64");
  }

  return {
    timestamp: new Date().toISOString(),
    tab,
    selection: raw.selection ?? "",
    visibleText,
    focusedElement: raw.focusedElement ?? null,
    interactiveElements: raw.interactiveElements ?? [],
    screenshot,
  };
}

export async function extractFocusedElement(page: Page): Promise<ElementInfo | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute("type") ?? undefined;
    if (type === "password") {
      return {
        tag,
        tagName: tag,
        type: "password",
        fingerprint: [tag, "password"].join("|"),
      };
    }
    const html = el as HTMLElement;
    const fingerprint = [
      tag,
      type ?? "",
      el.getAttribute("id") ?? "",
      el.getAttribute("name") ?? "",
      el.getAttribute("placeholder") ?? "",
      el.getAttribute("aria-label") ?? "",
      el.getAttribute("role") ?? "",
      html.isContentEditable ? "contenteditable" : "",
    ].join("|");
    return {
      tag,
      tagName: tag,
      type,
      role: el.getAttribute("role") ?? undefined,
      text: (el.textContent ?? "").slice(0, 120) || undefined,
      ariaLabel: el.getAttribute("aria-label") ?? undefined,
      placeholder: el.getAttribute("placeholder") ?? undefined,
      value:
        type === "password"
          ? undefined
          : typeof (el as HTMLInputElement).value === "string"
            ? (el as HTMLInputElement).value.slice(0, 200)
            : undefined,
      fingerprint,
      selector: el.id ? `#${CSS.escape(el.id)}` : undefined,
    };
  });
}

export async function extractVisibleText(page: Page, maxChars: number): Promise<string> {
  const text = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent) continue;
      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const t = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) parts.push(t);
    }
    return parts.join("\n");
  });
  if (text.length > maxChars) {
    return text.slice(0, maxChars) + `\n…[truncated]`;
  }
  return text;
}

export function summarizeFocused(focused: PageContext["focusedElement"]): string {
  if (!focused) return "none";
  const bits = [focused.tagName];
  if (focused.type) bits.push(`type=${focused.type}`);
  if (focused.placeholder) bits.push(`placeholder="${focused.placeholder}"`);
  if (focused.ariaLabel) bits.push(`aria-label="${focused.ariaLabel}"`);
  return bits.join(" ");
}
