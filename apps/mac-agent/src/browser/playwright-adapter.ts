import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import type {
  CopilotConfig,
  ElementInfo,
  PageContext,
  TabInfo,
  TypingConfig,
} from "@remote-ai-copilot/shared-types";
import type { ComponentLogger } from "@remote-ai-copilot/logger";
import type { BrowserAdapter } from "./adapter.js";
import {
  extractFocusedElement,
  extractPageContext,
  extractVisibleText,
} from "./context-extractor.js";

interface PageEntry {
  id: number;
  page: Page;
}

export class PlaywrightAdapter implements BrowserAdapter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages = new Map<number, PageEntry>();
  private nextId = 1;
  private selectedTabId: number | null = null;
  private connected = false;
  private stopRequested = false;

  constructor(
    private readonly config: CopilotConfig,
    private readonly logger: ComponentLogger
  ) {}

  isConnected(): boolean {
    return this.connected && this.browser !== null;
  }

  private connectionMode: "playwright" | "cdp" = "playwright";

  async connect(): Promise<void> {
    if (this.connected) return;
    this.logger.event("BROWSER_CONNECTION_STARTED", "STARTED", {
      details: { mode: this.config.browser.mode },
    });
    const started = Date.now();
    try {
      if (this.config.browser.mode === "cdp") {
        await this.connectOverCdp();
      } else {
        await this.connectLaunch();
      }
      this.connected = true;
      this.logger.event("BROWSER_CONNECTED", "SUCCESS", {
        durationMs: Date.now() - started,
        details: {
          mode: this.connectionMode,
          headless: this.config.browser.headless,
          tabs: this.pages.size,
        },
      });
    } catch (error) {
      this.logger.event("BROWSER_CONNECTED", "FAILED", {
        durationMs: Date.now() - started,
        error: { message: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  private async connectLaunch(): Promise<void> {
    this.connectionMode = "playwright";
    this.browser = await chromium.launch({
      headless: this.config.browser.headless,
    });
    this.context = await this.browser.newContext();
    this.context.on("page", (page) => {
      this.trackPage(page);
    });
    const page = await this.context.newPage();
    this.trackPage(page);
  }

  /**
   * Attach to an already-running Chromium/Chrome with remote debugging.
   * Use a dedicated --user-data-dir profile (Chrome 136+ blocks default profile).
   */
  private async connectOverCdp(): Promise<void> {
    this.connectionMode = "cdp";
    const endpoint = this.config.browser.cdpEndpoint;
    this.browser = await chromium.connectOverCDP(endpoint);
    const contexts = this.browser.contexts();
    this.context = contexts[0] ?? (await this.browser.newContext());
    this.context.on("page", (page) => {
      this.trackPage(page);
    });
    const existing = this.context.pages();
    if (existing.length === 0) {
      const page = await this.context.newPage();
      this.trackPage(page);
    } else {
      for (const page of existing) {
        this.trackPage(page);
      }
    }
  }

  async disconnect(): Promise<void> {
    this.stopRequested = true;
    try {
      if (this.connectionMode === "cdp") {
        // Do not close the user's Chrome — only detach Playwright
        await this.browser?.close();
      } else {
        await this.context?.close();
        await this.browser?.close();
      }
    } finally {
      this.browser = null;
      this.context = null;
      this.pages.clear();
      this.selectedTabId = null;
      this.connected = false;
      this.logger.event("BROWSER_DISCONNECTED", "SUCCESS", {
        details: { mode: this.connectionMode },
      });
    }
  }

  private trackPage(page: Page): number {
    for (const entry of this.pages.values()) {
      if (entry.page === page) return entry.id;
    }
    const id = this.nextId++;
    this.pages.set(id, { id, page });
    if (this.selectedTabId === null) {
      this.selectedTabId = id;
    }
    page.on("close", () => {
      this.pages.delete(id);
      if (this.selectedTabId === id) {
        const first = this.pages.keys().next();
        this.selectedTabId = first.done ? null : first.value;
      }
    });
    page.on("framenavigated", async () => {
      this.logger.event("BROWSER_TAB_DISCOVERED", "SUCCESS", {
        details: { tabId: id, url: page.url() },
      });
    });
    this.logger.event("BROWSER_TAB_DISCOVERED", "SUCCESS", {
      details: { tabId: id, url: page.url() },
    });
    return id;
  }

  private requirePage(): PageEntry {
    if (!this.connected || this.selectedTabId === null) {
      throw new Error("Browser not connected or no active tab");
    }
    const entry = this.pages.get(this.selectedTabId);
    if (!entry) {
      throw new Error(`Selected tab ${this.selectedTabId} not found`);
    }
    return entry;
  }

  /** Test helper: focus a CSS selector in the selected tab */
  async focusSelector(selector: string): Promise<void> {
    const entry = this.requirePage();
    await entry.page.click(selector);
  }

  /** Test helper: read input value */
  async inputValue(selector: string): Promise<string> {
    const entry = this.requirePage();
    return entry.page.inputValue(selector);
  }

  /** Test helper: clear an input/textarea */
  async clearSelector(selector: string): Promise<void> {
    const entry = this.requirePage();
    await entry.page.fill(selector, "");
  }

  async getTabs(): Promise<TabInfo[]> {
    const tabs: TabInfo[] = [];
    for (const entry of this.pages.values()) {
      tabs.push({
        id: entry.id,
        url: entry.page.url(),
        title: await entry.page.title().catch(() => ""),
      });
    }
    return tabs;
  }

  async getActiveTab(): Promise<TabInfo> {
    const entry = this.requirePage();
    const tab = {
      id: entry.id,
      url: entry.page.url(),
      title: await entry.page.title().catch(() => ""),
    };
    return tab;
  }

  async selectTab(tabId: number): Promise<TabInfo> {
    const entry = this.pages.get(tabId);
    if (!entry) {
      throw new Error(`Tab ${tabId} not found`);
    }
    this.selectedTabId = tabId;
    await entry.page.bringToFront();
    const tab = {
      id: entry.id,
      url: entry.page.url(),
      title: await entry.page.title().catch(() => ""),
    };
    this.logger.event("BROWSER_TAB_SELECTED", "SUCCESS", {
      details: { tabId, url: tab.url },
    });
    return tab;
  }

  async openUrl(url: string): Promise<TabInfo> {
    const entry = this.requirePage();
    await entry.page.goto(url, { waitUntil: "domcontentloaded" });
    return this.getActiveTab();
  }

  async getPageContext(): Promise<PageContext> {
    const entry = this.requirePage();
    const started = Date.now();
    this.logger.event("BROWSER_CONTEXT_CAPTURE_STARTED", "STARTED", {
      details: { tabId: entry.id },
    });
    try {
      const tab = await this.getActiveTab();
      const context = await extractPageContext(entry.page, tab, {
        maxVisibleTextChars: this.config.browser.maxVisibleTextChars,
        includeScreenshot: false,
      });
      this.logger.event("BROWSER_CONTEXT_CAPTURE_SUCCESS", "SUCCESS", {
        durationMs: Date.now() - started,
        details: {
          tabId: tab.id,
          url: tab.url,
          textLength: context.visibleText.length,
          screenshotCaptured: false,
        },
      });
      return context;
    } catch (error) {
      this.logger.event("BROWSER_CONTEXT_CAPTURE_FAILED", "FAILED", {
        durationMs: Date.now() - started,
        error: { message: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  async getVisibleText(): Promise<string> {
    const entry = this.requirePage();
    return extractVisibleText(entry.page, this.config.browser.maxVisibleTextChars);
  }

  async getSelectedText(): Promise<string> {
    const entry = this.requirePage();
    return entry.page.evaluate(() => window.getSelection()?.toString() ?? "");
  }

  async getInteractiveElements(): Promise<ElementInfo[]> {
    const ctx = await this.getPageContext();
    return ctx.interactiveElements.map((el) => ({
      tag: el.tag,
      role: el.role,
      text: el.text,
      ariaLabel: el.ariaLabel,
      placeholder: el.placeholder,
      selector: el.selector,
    }));
  }

  async getAccessibilityTree(): Promise<unknown> {
    const entry = this.requirePage();
    // Playwright Aria snapshot (accessibility.snapshot was removed in recent Playwright)
    const snapshot = await entry.page.locator("body").ariaSnapshot();
    return snapshot;
  }

  async screenshot(): Promise<Buffer> {
    const entry = this.requirePage();
    const buf = await entry.page.screenshot({ type: "png", fullPage: false });
    this.logger.event("BROWSER_SCREENSHOT_CAPTURED", "SUCCESS", {
      details: { tabId: entry.id, bytes: buf.length },
    });
    return buf;
  }

  async getFocusedElement(): Promise<ElementInfo | null> {
    const entry = this.requirePage();
    return extractFocusedElement(entry.page);
  }

  async insertText(
    text: string,
    signal: AbortSignal,
    opts?: {
      replace?: boolean;
      onProgress?: (typedChars: number) => void;
    }
  ): Promise<{ typedChars: number }> {
    this.stopRequested = false;
    const entry = this.requirePage();
    const typing = this.config.typing;
    const focused = await extractFocusedElement(entry.page);
    const replace = opts?.replace ?? false;

    if (!focused) {
      throw new Error("No focused editable element");
    }
    if (focused.type === "password") {
      throw new Error("Refusing to type into password fields");
    }

    const editable =
      focused.tag === "textarea" ||
      focused.tag === "input" ||
      focused.tagName === "textarea" ||
      focused.tagName === "input" ||
      (focused.fingerprint ?? "").includes("contenteditable") ||
      focused.role === "textbox";

    if (!editable) {
      throw new Error(`Focused element is not editable: ${focused.tag}`);
    }

    this.logger.event("TYPING_STARTED", "STARTED", {
      details: { length: text.length, mode: typing.mode, replace },
    });

    await entry.page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return;
      el.focus();
    });

    if (replace) {
      await this.clearFocused(entry.page);
    }

    if (typing.mode === "instant") {
      if (signal.aborted || this.stopRequested) {
        this.logger.event("TYPING_CANCELLED", "CANCELLED", {
          details: { typedChars: 0 },
        });
        throw new DOMException("Aborted", "AbortError");
      }
      await this.insertInstant(entry.page, text, replace);
      opts?.onProgress?.(text.length);
      this.logger.event("TYPING_COMPLETED", "SUCCESS", {
        details: { length: text.length },
      });
      return { typedChars: text.length };
    }

    return this.insertChunked(entry.page, text, typing, signal, opts?.onProgress);
  }

  private async clearFocused(page: Page): Promise<void> {
    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.select();
      } else if (el.isContentEditable) {
        document.execCommand("selectAll", false);
      }
    });
    await page.keyboard.press("Backspace");
  }

  private async insertInstant(
    page: Page,
    text: string,
    replace: boolean
  ): Promise<void> {
    const handled = await page.evaluate(
      ({ value, shouldReplace }) => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return false;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          const start = shouldReplace ? 0 : el.selectionStart ?? el.value.length;
          const end = shouldReplace ? el.value.length : el.selectionEnd ?? start;
          const next = el.value.slice(0, start) + value + el.value.slice(end);
          const proto =
            el instanceof HTMLTextAreaElement
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (setter) setter.call(el, next);
          else el.value = next;
          const caret = start + value.length;
          el.setSelectionRange(caret, caret);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        if (el.isContentEditable) {
          el.focus();
          if (shouldReplace) document.execCommand("selectAll", false);
          document.execCommand("insertText", false, value);
          return true;
        }
        return false;
      },
      { value: text, shouldReplace: replace }
    );

    if (!handled) {
      await page.keyboard.type(text, { delay: 0 });
    }
  }

  private async insertChunked(
    page: Page,
    text: string,
    typing: TypingConfig,
    signal: AbortSignal,
    onProgress?: (typedChars: number) => void
  ): Promise<{ typedChars: number }> {
    const chunkSize =
      typing.mode === "human_paced" ? 1 : Math.max(1, typing.chunkSize);
    const delay =
      typing.mode === "human_paced"
        ? Math.max(1, Math.round(1000 / Math.max(1, typing.charactersPerSecond)))
        : typing.delayBetweenChunksMs;

    let typed = 0;
    for (let i = 0; i < text.length; i += chunkSize) {
      if (signal.aborted || this.stopRequested) {
        onProgress?.(typed);
        this.logger.event("TYPING_CANCELLED", "CANCELLED", {
          details: { typedChars: typed },
        });
        throw new DOMException("Aborted", "AbortError");
      }
      const chunk = text.slice(i, i + chunkSize);
      await page.keyboard.type(chunk, { delay: 0 });
      typed += chunk.length;
      onProgress?.(typed);
      this.logger.event("TYPING_CHUNK_COMPLETED", "SUCCESS", {
        details: { offset: i, chunkSize: chunk.length, typedChars: typed },
      });
      if (i + chunkSize < text.length && delay > 0) {
        try {
          await sleep(delay, signal);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            onProgress?.(typed);
            this.logger.event("TYPING_CANCELLED", "CANCELLED", {
              details: { typedChars: typed },
            });
          }
          throw error;
        }
      }
    }

    this.logger.event("TYPING_COMPLETED", "SUCCESS", {
      details: { length: text.length },
    });
    return { typedChars: typed };
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
