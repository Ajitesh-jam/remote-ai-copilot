import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createLogger } from "@remote-ai-copilot/logger";
import type { CopilotConfig } from "@remote-ai-copilot/shared-types";
import { PlaywrightAdapter } from "../../apps/mac-agent/src/browser/playwright-adapter.js";
import { loadConfig, getRepoRoot } from "../../apps/mac-agent/src/config.js";

describe("PlaywrightAdapter", () => {
  let adapter: PlaywrightAdapter;
  let config: CopilotConfig;

  beforeAll(async () => {
    config = loadConfig({ ...process.env, NODE_ENV: "development" });
    config.browser.headless = true;
    config.typing.mode = "instant";
    const logger = createLogger({
      sessionId: "test-session",
      logDirectory: path.join(getRepoRoot(), "logs"),
      pretty: false,
      level: "warn",
    });
    adapter = new PlaywrightAdapter(config, logger.child("browser"));
    await adapter.connect();
  }, 60_000);

  afterAll(async () => {
    await adapter.disconnect();
  });

  it("reads visible text from fixture and types into textarea", async () => {
    const fixture = path.join(getRepoRoot(), "tests/fixtures/typing-test.html");
    const url = pathToFileURL(fixture).href;
    await adapter.openUrl(url);

    const text = await adapter.getVisibleText();
    expect(text).toContain("Typing Fixture");
    expect(text).toContain("Project Orion");

    const context = await adapter.getPageContext();
    expect(context.tab.url).toContain("typing-test.html");
    expect(context.visibleText.length).toBeGreaterThan(20);

    const tabs = await adapter.getTabs();
    expect(tabs.length).toBeGreaterThan(0);

    await adapter.focusSelector("#reply");
    const focused = await adapter.getFocusedElement();
    expect(focused?.tagName ?? focused?.tag).toBe("textarea");

    const controller = new AbortController();
    await adapter.insertText("Hello from PlaywrightAdapter test", controller.signal);

    const value = await adapter.inputValue("#reply");
    expect(value).toBe("Hello from PlaywrightAdapter test");
  }, 60_000);

  it("halts mid-typing when aborted", async () => {
    const fixture = path.join(getRepoRoot(), "tests/fixtures/typing-test.html");
    await adapter.openUrl(pathToFileURL(fixture).href);

    config.typing.mode = "chunked";
    config.typing.chunkSize = 5;
    config.typing.delayBetweenChunksMs = 80;

    await adapter.clearSelector("#reply");
    await adapter.focusSelector("#reply");

    config.typing.mode = "chunked";
    const controller = new AbortController();
    const longText = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const typingPromise = adapter.insertText(longText, controller.signal);
    await new Promise((r) => setTimeout(r, 150));
    controller.abort();

    await expect(typingPromise).rejects.toMatchObject({ name: "AbortError" });
    const value = await adapter.inputValue("#reply");
    expect(value.length).toBeGreaterThan(0);
    expect(value.length).toBeLessThan(longText.length);
  }, 60_000);
});
