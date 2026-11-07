import type { CopilotConfig } from "@remote-ai-copilot/shared-types";
import type { ComponentLogger } from "@remote-ai-copilot/logger";

export interface ShortcutHandlers {
  onPrepare: () => void | Promise<void>;
  onGo: () => void | Promise<void>;
  onHalt: () => void | Promise<void>;
}

export interface ShortcutRegistration {
  stop: () => Promise<void> | void;
  backend: "global-shortcuts" | "none";
}

/**
 * Map config style "Command+Option+P" to global-shortcuts style "cmd+alt+p"
 */
export function toHotkeyString(combo: string): string {
  return combo
    .toLowerCase()
    .replace(/command/g, "cmd")
    .replace(/option/g, "alt")
    .replace(/control/g, "ctrl")
    .replace(/\s+/g, "")
    .replace(/\+/g, "+");
}

async function tryLoadGlobalShortcuts(): Promise<
  typeof import("global-shortcuts") | null
> {
  try {
    return await import("global-shortcuts");
  } catch {
    return null;
  }
}

export async function registerShortcuts(
  config: CopilotConfig,
  handlers: ShortcutHandlers,
  logger: ComponentLogger
): Promise<ShortcutRegistration> {
  const mod = await tryLoadGlobalShortcuts();
  if (!mod?.GlobalHotKeyManager) {
    logger.event("HOTKEY_REGISTRATION_FAILED", "FAILED", {
      error: {
        message: "global-shortcuts not installed",
        code: "MODULE_MISSING",
      },
      details: {
        hint: "npm i global-shortcuts — or use CLI: copilot prepare|go|halt",
      },
    });
    return { backend: "none", stop: () => undefined };
  }

  const manager = new mod.GlobalHotKeyManager();
  const ids: string[] = [];

  const wrap = (name: string, fn: () => void | Promise<void>) => {
    return async () => {
      logger.event(name, "STARTED");
      try {
        await fn();
      } catch (error) {
        logger.event(name, "FAILED", {
          error: { message: error instanceof Error ? error.message : String(error) },
        });
      }
    };
  };

  try {
    const prepareKey = toHotkeyString(config.shortcuts.prepare);
    const goKey = toHotkeyString(config.shortcuts.go);
    const haltKey = toHotkeyString(config.shortcuts.halt);

    ids.push(
      await manager.register(prepareKey, wrap("HOTKEY_PREPARE", handlers.onPrepare)),
      await manager.register(goKey, wrap("HOTKEY_GO", handlers.onGo)),
      await manager.register(haltKey, wrap("HOTKEY_HALT", handlers.onHalt))
    );

    logger.event("HOTKEY_REGISTRATION_SUCCESS", "SUCCESS", {
      details: {
        prepare: prepareKey,
        go: goKey,
        halt: haltKey,
        backend: "global-shortcuts",
      },
    });

    return {
      backend: "global-shortcuts",
      stop: async () => {
        for (const id of ids) {
          try {
            await manager.unregister(id);
          } catch {
            // ignore
          }
        }
        try {
          await manager.dispose?.();
        } catch {
          // ignore
        }
      },
    };
  } catch (error) {
    logger.event("HOTKEY_REGISTRATION_FAILED", "FAILED", {
      error: { message: error instanceof Error ? error.message : String(error) },
    });
    return { backend: "none", stop: () => undefined };
  }
}
