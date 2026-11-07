#!/usr/bin/env node
import { unlinkSync, existsSync } from "node:fs";
import { loadConfig, getPidFilePath } from "./config.js";
import { AgentSession } from "./session.js";
import { startAgentApi } from "./api/server.js";
import { registerShortcuts } from "./keyboard/shortcuts.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const session = new AgentSession(config);

  const api = await startAgentApi(session);

  const shortcuts = await registerShortcuts(
    config,
    {
      onPrepare: async () => {
        try {
          await session.prepare();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          session.setLastError(message);
          session.notify("PREPARE failed", message);
        }
      },
      onGo: async () => {
        try {
          await session.go();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          session.setLastError(message);
          session.notify("GO failed", message);
        }
      },
      onHalt: () => {
        session.halt();
      },
    },
    session.logger.child("keyboard")
  );

  session.logger.child("agent").info("Agent ready", {
    address: api.address,
    shortcuts: shortcuts.backend,
  });

  const shutdown = async (signal: string) => {
    session.logger.child("agent").event("AGENT_STOPPED", "STARTED", {
      details: { signal },
    });
    try {
      await shortcuts.stop();
      session.halt();
      if (session.browser.isConnected()) {
        await session.disconnectBrowser();
      }
      await api.close();
    } finally {
      const pidFile = getPidFilePath(config);
      if (existsSync(pidFile)) {
        unlinkSync(pidFile);
      }
      session.logger.child("agent").event("AGENT_STOPPED", "SUCCESS");
      process.exit(0);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
