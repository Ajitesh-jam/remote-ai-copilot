import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { loadConfig, getRepoRoot } from "../../apps/mac-agent/src/config.js";
import { AgentSession } from "../../apps/mac-agent/src/session.js";

describe("PREPARE → GO session", () => {
  let session: AgentSession;

  beforeAll(async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: "development" });
    config.browser.headless = true;
    config.typing.mode = "instant";
    config.logging.logDirectory = path.join(getRepoRoot(), "logs");
    session = new AgentSession(config);
    await session.connectBrowser();
  }, 60_000);

  afterAll(async () => {
    await session.disconnectBrowser();
  });

  it("prepares a draft without typing, then GO inserts after focus", async () => {
    const fixture = path.join(getRepoRoot(), "tests/fixtures/typing-test.html");
    await session.browser.openUrl(pathToFileURL(fixture).href);

    const prepared = await session.prepare("Write a short professional reply.");
    expect(prepared.draft).toContain("Stub draft");
    expect(prepared.draft).toContain("Write a short professional reply");
    expect(session.state.getState()).toBe("DRAFT_READY");

    // Value should still be empty (PREPARE must not type)
    const adapter = session.browser as unknown as {
      inputValue: (s: string) => Promise<string>;
      focusSelector: (s: string) => Promise<void>;
      clearSelector: (s: string) => Promise<void>;
    };
    await adapter.clearSelector("#reply");
    expect(await adapter.inputValue("#reply")).toBe("");

    // Focus must match prepare snapshot — re-prepare with focus set
    await adapter.focusSelector("#reply");
    await session.prepare("Write a short professional reply.");
    expect(session.state.getState()).toBe("DRAFT_READY");

    const go = await session.go();
    expect(go.typed).toBe(true);
    expect(session.state.getState()).toBe("COMPLETED");
    const value = await adapter.inputValue("#reply");
    expect(value).toContain("Stub draft");
  }, 60_000);

  it("HALT aborts and preserves draft", async () => {
    const fixture = path.join(getRepoRoot(), "tests/fixtures/typing-test.html");
    await session.browser.openUrl(pathToFileURL(fixture).href);
    const adapter = session.browser as unknown as {
      focusSelector: (s: string) => Promise<void>;
      clearSelector: (s: string) => Promise<void>;
    };
    await adapter.clearSelector("#reply");
    await adapter.focusSelector("#reply");
    await session.prepare("halt test");
    const draftBefore = session.getDraft()?.draft;
    session.halt();
    expect(session.state.getState()).toBe("HALTED");
    expect(session.getDraft()?.draft).toBe(draftBefore);
  }, 60_000);
});
