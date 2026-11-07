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

  app.post("/api/browser/connect", async () => {
    await session.connectBrowser();
    return { ok: true };
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

  app.post<{ Body: { text: string } }>("/api/browser/type", async (req) => {
    const text = req.body?.text;
    if (typeof text !== "string" || !text.length) {
      throw new Error("text is required");
    }
    const { signal } = session.execution.begin();
    await session.browser.insertText(text, signal);
    return { ok: true };
  });

  app.post<{ Body: { instruction?: string } }>("/api/prepare", async (req) => {
    const result = await session.prepare(req.body?.instruction);
    return {
      ok: true,
      draft: result.draft,
      explanation: result.explanation,
      tab: result.context.tab,
    };
  });

  app.post("/api/go", async () => {
    return session.go();
  });

  app.post("/api/halt", async () => {
    session.halt();
    return { ok: true, state: session.state.getState() };
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
