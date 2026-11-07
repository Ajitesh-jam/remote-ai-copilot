import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CopilotConfig } from "@remote-ai-copilot/shared-types";
import type { ComponentLogger } from "@remote-ai-copilot/logger";

export interface ShortcutHandlers {
  onPrepare: () => void | Promise<void>;
  onGo: () => void | Promise<void>;
  onHalt: () => void | Promise<void>;
  onResume: () => void | Promise<void>;
}

export interface ShortcutRegistration {
  stop: () => Promise<void> | void;
  backend: "hotkey-bridge" | "none";
}

export function toHotkeyString(combo: string): string {
  return combo
    .toLowerCase()
    .replace(/command/g, "cmd")
    .replace(/option/g, "alt")
    .replace(/control/g, "ctrl")
    .replace(/\s+/g, "")
    .replace(/\+/g, "+");
}

export function parseCombo(combo: string): {
  key: string;
  meta: boolean;
  alt: boolean;
  ctrl: boolean;
  shift: boolean;
} {
  const parts = combo.toLowerCase().split("+").map((p) => p.trim());
  const key = parts[parts.length - 1] ?? "";
  return {
    key,
    meta: parts.some((p) => p === "command" || p === "cmd" || p === "meta"),
    alt: parts.some((p) => p === "option" || p === "alt"),
    ctrl: parts.some((p) => p === "control" || p === "ctrl"),
    shift: parts.some((p) => p === "shift"),
  };
}

/**
 * Spawn an isolated hotkey bridge so sudo-prompt / NGKL crashes cannot kill the agent.
 * Handlers are invoked via the agent's HTTP API from the bridge process.
 */
export async function registerShortcuts(
  config: CopilotConfig,
  _handlers: ShortcutHandlers,
  logger: ComponentLogger
): Promise<ShortcutRegistration> {
  if (process.env.COPILOT_DISABLE_HOTKEYS === "1") {
    logger.event("HOTKEY_REGISTRATION_FAILED", "CANCELLED", {
      details: { reason: "COPILOT_DISABLE_HOTKEYS=1" },
    });
    return { backend: "none", stop: () => undefined };
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const bridgeJs = path.join(here, "hotkey-bridge.js");
  const bridgeTs = path.join(here, "hotkey-bridge.ts");
  // Prefer compiled JS next to this file; fall back to tsx on .ts source
  const entry = (await exists(bridgeJs)) ? bridgeJs : bridgeTs;
  const args = entry.endsWith(".ts") ? ["--import", "tsx", entry] : [entry];

  let child: ChildProcess | null = null;
  try {
    child = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        COPILOT_URL: `http://${config.agent.host}:${config.agent.port}`,
      },
      detached: false,
    });

    child.stdout?.on("data", (buf: Buffer) => {
      logger.info(buf.toString("utf8").trim());
    });
    child.stderr?.on("data", (buf: Buffer) => {
      logger.warn(buf.toString("utf8").trim());
    });
    child.on("exit", (code) => {
      logger.warn("Hotkey bridge exited", { code });
    });

    // Give bridge a moment; if it dies immediately, report failure but keep agent alive
    await new Promise((r) => setTimeout(r, 400));
    if (child.exitCode !== null) {
      logger.event("HOTKEY_REGISTRATION_FAILED", "FAILED", {
        error: {
          message: `hotkey-bridge exited with code ${child.exitCode}`,
          code: "BRIDGE_EXIT",
        },
        details: {
          hint: "Use CLI: copilot prepare|go|halt|resume. Grant Accessibility if using hotkeys.",
          shortcuts: config.shortcuts,
        },
      });
      return { backend: "none", stop: () => undefined };
    }

    logger.event("HOTKEY_REGISTRATION_SUCCESS", "SUCCESS", {
      details: {
        backend: "hotkey-bridge",
        shortcuts: config.shortcuts,
        note: "Uses Control+Option (not Cmd+Option) to avoid Chrome conflicts. Needs Accessibility permission.",
      },
    });

    const proc = child;
    return {
      backend: "hotkey-bridge",
      stop: () => {
        try {
          proc.kill("SIGTERM");
        } catch {
          // ignore
        }
      },
    };
  } catch (error) {
    logger.event("HOTKEY_REGISTRATION_FAILED", "FAILED", {
      error: { message: error instanceof Error ? error.message : String(error) },
      details: { shortcuts: config.shortcuts },
    });
    return { backend: "none", stop: () => undefined };
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    const { access } = await import("node:fs/promises");
    await access(p);
    return true;
  } catch {
    return false;
  }
}
