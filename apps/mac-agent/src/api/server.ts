import Fastify from "fastify";
import { writeFileSync, mkdirSync } from "node:fs";
import type { AgentSession } from "../session.js";
import { getPidFilePath } from "../config.js";

export async function startAgentApi(session: AgentSession): Promise<{
  close: () => Promise<void>;
  address: string;
}> {
  const config = session.getConfig();
  const app = Fastify({ logger: false });

  app.addHook("onRequest", async (req, reply) => {
    // Localhost-only safety: reject non-loopback if somehow bound broader
    const host = req.ip;
    if (host && host !== "127.0.0.1" && host !== "::1" && host !== ":ffff:127.0.0.1") {
      return reply.code(403).send({ error: "Forbidden" });
    }
  });

  app.get("/health", async () => ({
    ok: true,
    agent: "running",
    state: session.state.getState(),
    browser: session.browser.isConnected() ? "connected" : "disconnected",
  }));

  app.get("/health/agent", async () => ({
    status: "running",
    state: session.state.getState(),
    pid: process.pid,
    uptimeMs: Date.now() - session.startedAt,
  }));

  app.get("/health/browser", async () => ({
    status: session.browser.isConnected() ? "connected" : "disconnected",
  }));

  app.get("/api/status", async () => session.getStatusAsync());

  app.post<{ Body: { mode?: "playwright" | "cdp" } }>("/api/browser/connect", async (req) => {
    const mode = req.body?.mode;
    if (mode === "playwright" || mode === "cdp") {
      session.getConfig().browser.mode = mode;
    }
    await session.connectBrowser();
    return {
      ok: true,
      mode: session.getConfig().browser.mode,
      cdpEndpoint: session.getConfig().browser.cdpEndpoint,
    };
  });

  app.post("/api/browser/disconnect", async () => {
    await session.disconnectBrowser();
    return { ok: true };
  });

  app.get("/api/browser/tabs", async () => {
    return { tabs: await session.browser.getTabs() };
  });

  app.post<{ Body: { tabId: number } }>("/api/browser/select", async (req) => {
    const tab = await session.browser.selectTab(req.body.tabId);
    return { tab };
  });

  app.post<{ Body: { url: string } }>("/api/browser/open", async (req) => {
    const tab = await session.browser.openUrl(req.body.url);
    return { tab };
  });

  app.get("/api/browser/read", async () => {
    return { context: await session.browser.getPageContext() };
  });

  app.get("/api/browser/text", async () => {
    return { text: await session.browser.getVisibleText() };
  });

  app.get("/api/browser/focus", async () => {
    return { focused: await session.browser.getFocusedElement() };
  });

  app.get("/api/browser/elements", async () => {
    return { elements: await session.browser.getInteractiveElements() };
  });

  app.get("/api/browser/a11y", async () => {
    return { tree: await session.browser.getAccessibilityTree() };
  });

  app.get("/api/browser/url", async () => {
    const tab = await session.browser.getActiveTab();
    return { url: tab.url, title: tab.title, id: tab.id };
  });

  app.get("/api/browser/screenshot", async (_req, reply) => {
    const buf = await session.browser.screenshot();
    return reply.type("image/png").send(buf);
  });

  app.post<{ Body: { selector: string } }>("/api/browser/focus-selector", async (req) => {
    const selector = req.body?.selector;
    if (!selector) throw new Error("selector is required");
    const browser = session.browser as {
      focusSelector?: (s: string) => Promise<void>;
    };
    if (!browser.focusSelector) {
      throw new Error("focusSelector not supported by current adapter");
    }
    await browser.focusSelector(selector);
    return { ok: true, focused: await session.browser.getFocusedElement() };
  });

  app.post<{ Body: { text: string; replace?: boolean } }>("/api/browser/type", async (req) => {
    const text = req.body?.text;
    if (typeof text !== "string" || !text.length) {
      throw new Error("text is required");
    }
    const { signal } = session.execution.begin();
    const result = await session.browser.insertText(text, signal, {
      replace: !!req.body?.replace,
    });
    return { ok: true, typedChars: result.typedChars };
  });

  app.post<{ Body: { instruction?: string } }>("/api/prepare", async (req) => {
    const result = await session.prepare(req.body?.instruction);
    return {
      ok: true,
      draft: result.draft,
      explanation: result.explanation,
      resolvedInstruction: result.resolvedInstruction,
      tab: result.context.tab,
    };
  });

  app.post("/api/go", async () => {
    return session.go();
  });

  app.post("/api/resume", async () => {
    return session.resume();
  });

  app.post("/api/halt", async () => {
    session.halt();
    return {
      ok: true,
      state: session.state.getState(),
      canResume: !!session.getRemaining()?.length,
      remainingLength: session.getRemaining()?.length ?? 0,
    };
  });

  app.post("/api/lock", async () => {
    session.lock();
    return { ok: true };
  });

  app.post("/api/unlock", async () => {
    session.unlock();
    return { ok: true };
  });

  app.post("/api/shutdown", async (_req, reply) => {
    reply.send({ ok: true });
    setImmediate(async () => {
      try {
        session.halt();
        if (session.browser.isConnected()) {
          await session.disconnectBrowser();
        }
      } finally {
        process.exit(0);
      }
    });
  });

  const address = await app.listen({
    host: config.agent.host,
    port: config.agent.port,
  });

  mkdirSync(config.logging.logDirectory, { recursive: true });
  writeFileSync(
    getPidFilePath(config),
    JSON.stringify({
      pid: process.pid,
      port: config.agent.port,
      host: config.agent.host,
      sessionId: session.sessionId,
      startedAt: new Date(session.startedAt).toISOString(),
    }),
    "utf8"
  );

  session.logger.child("agent").event("AGENT_STARTED", "SUCCESS", {
    details: { address, pid: process.pid },
  });

  return {
    address,
    close: async () => {
      await app.close();
    },
  };
}

export function agentBaseUrl(host = "127.0.0.1", port = 8787): string {
  return `http://${host}:${port}`;
}
