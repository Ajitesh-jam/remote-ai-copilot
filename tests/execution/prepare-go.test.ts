import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { loadConfig, getRepoRoot } from "../../apps/mac-agent/src/config.js";
import { AgentSession } from "../../apps/mac-agent/src/session.js";
import type { PlaywrightAdapter } from "../../apps/mac-agent/src/browser/playwright-adapter.js";

describe("PREPARE → GO → HALT → RESUME", () => {
  let session: AgentSession;
  let adapter: PlaywrightAdapter;

  beforeAll(async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: "development" });
    config.browser.headless = true;
    config.typing.mode = "chunked";
    config.typing.chunkSize = 5;
    config.typing.delayBetweenChunksMs = 60;
    config.agent.replaceFocusedOnGo = true;
    config.logging.logDirectory = path.join(getRepoRoot(), "logs");
    session = new AgentSession(config);
    adapter = session.browser as PlaywrightAdapter;
    await session.connectBrowser();
  }, 60_000);

  afterAll(async () => {
    await session.disconnectBrowser();
  });

  it("reads prompt from focused field, GO types code, HALT pauses, RESUME finishes", async () => {
    const fixture = path.join(getRepoRoot(), "tests/fixtures/typing-test.html");
    await adapter.openUrl(pathToFileURL(fixture).href);
    await adapter.clearSelector("#reply");
    await adapter.focusSelector("#reply");

    // Put the user prompt in the field (what PREPARE should read)
    await adapter.insertText(
      "write me python code for printing hello world",
      new AbortController().signal,
      { replace: true }
    );

    const prepared = await session.prepare();
    expect(prepared.resolvedInstruction.toLowerCase()).toContain("python");
    expect(prepared.draft).toContain("Hello, World!");
    expect(prepared.draft).toContain("def main()");
    expect(session.state.getState()).toBe("DRAFT_READY");

    // Focus again for GO (prepare does not change focus)
    await adapter.focusSelector("#reply");

    const goPromise = session.go();
    await new Promise((r) => setTimeout(r, 180));
    session.halt();
    const halted = await goPromise;

    expect(session.state.getState()).toBe("HALTED");
    expect(halted.remaining && halted.remaining.length > 0).toBe(true);

    const mid = await adapter.inputValue("#reply");
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.length).toBeLessThan(prepared.draft.length);

    await adapter.focusSelector("#reply");
    // Move caret to end so resume appends
    await (
      adapter as unknown as {
        pages: Map<number, { page: import("playwright").Page }>;
        selectedTabId: number;
      }
    ).pages
      .get(
        (adapter as unknown as { selectedTabId: number }).selectedTabId
      )!
      .page.evaluate(() => {
        const el = document.querySelector("#reply") as HTMLTextAreaElement;
        el.focus();
        el.selectionStart = el.selectionEnd = el.value.length;
      });

    const resumed = await session.resume();
    expect(resumed.typed).toBe(true);
    expect(session.state.getState()).toBe("COMPLETED");
    const final = await adapter.inputValue("#reply");
    expect(final).toContain("Hello, World!");
    expect(final).toContain("def main()");
  }, 90_000);

  it("new PREPARE cancels remaining resume work", async () => {
    const fixture = path.join(getRepoRoot(), "tests/fixtures/typing-test.html");
    await adapter.openUrl(pathToFileURL(fixture).href);
    await adapter.clearSelector("#reply");
    await adapter.focusSelector("#reply");
    await adapter.insertText(
      "write me python code for printing hello world",
      new AbortController().signal,
      { replace: true }
    );
    await session.prepare();
    await adapter.focusSelector("#reply");

    const goPromise = session.go();
    await new Promise((r) => setTimeout(r, 120));
    session.halt();
    await goPromise;
    expect(session.getRemaining()?.length).toBeGreaterThan(0);

    await adapter.focusSelector("#reply");
    await adapter.insertText(
      "write me javascript code for printing hello world",
      new AbortController().signal,
      { replace: true }
    );
    const next = await session.prepare();
    expect(next.draft).toContain("console.log");
    expect(session.state.getState()).toBe("DRAFT_READY");
    // remaining reset to full new draft
    expect(session.getRemaining()).toBe(next.draft);
  }, 90_000);
});
