#!/usr/bin/env node
/**
 * Isolated hotkey process. Crashes here must NOT take down the agent.
 * Posts to the local agent HTTP API when shortcuts are pressed.
 *
 * Polyfills Node util.isObject for node-global-key-listener / sudo-prompt on Node 22+.
 */
import util from "node:util";
import { loadConfig } from "../config.js";
import { parseCombo } from "./shortcuts.js";

// sudo-prompt (pulled in by node-global-key-listener) still calls removed util.* helpers
const utilAny = util as unknown as Record<string, unknown>;
if (typeof utilAny.isObject !== "function") {
  utilAny.isObject = (v: unknown) => v !== null && typeof v === "object";
}
if (typeof utilAny.isFunction !== "function") {
  utilAny.isFunction = (v: unknown) => typeof v === "function";
}
if (typeof utilAny.isString !== "function") {
  utilAny.isString = (v: unknown) => typeof v === "string";
}
if (typeof utilAny.isNullOrUndefined !== "function") {
  utilAny.isNullOrUndefined = (v: unknown) => v === null || v === undefined;
}

const baseUrl = process.env.COPILOT_URL ?? "http://127.0.0.1:8787";

async function post(route: string): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}${route}`, { method: "POST" });
    const body = await res.text();
    console.log(`[hotkey-bridge] ${route} -> ${res.status} ${body.slice(0, 200)}`);
  } catch (error) {
    console.error(`[hotkey-bridge] ${route} failed:`, error);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { GlobalKeyboardListener } = await import("node-global-key-listener");
  const v = new GlobalKeyboardListener({
    mac: {
      onError: (code: unknown) => console.error("[hotkey-bridge] mac error", code),
    },
  });

  const prepare = parseCombo(config.shortcuts.prepare);
  const go = parseCombo(config.shortcuts.go);
  const halt = parseCombo(config.shortcuts.halt);
  const resume = parseCombo(config.shortcuts.resume);

  const matches = (
    e: { name?: string; state: string },
    down: Record<string, boolean>,
    combo: ReturnType<typeof parseCombo>
  ): boolean => {
    if (e.state !== "DOWN") return false;
    const name = (e.name ?? "").toLowerCase();
    if (name !== combo.key.toLowerCase()) return false;
    const meta = !!(down["LEFT META"] || down["RIGHT META"]);
    const alt = !!(down["LEFT ALT"] || down["RIGHT ALT"]);
    const ctrl = !!(down["LEFT CTRL"] || down["RIGHT CTRL"]);
    const shift = !!(down["LEFT SHIFT"] || down["RIGHT SHIFT"]);
    return (
      meta === combo.meta &&
      alt === combo.alt &&
      ctrl === combo.ctrl &&
      shift === combo.shift
    );
  };

  console.log("[hotkey-bridge] listening", config.shortcuts);
  console.log("[hotkey-bridge] Grant Accessibility to Terminal/Node if keys do nothing.");

  v.addListener((e, down) => {
    if (matches(e, down, prepare)) {
      void post("/api/prepare");
      return true;
    }
    if (matches(e, down, go)) {
      void post("/api/go");
      return true;
    }
    if (matches(e, down, halt)) {
      void post("/api/halt");
      return true;
    }
    if (matches(e, down, resume)) {
      void post("/api/resume");
      return true;
    }
    return false;
  });
}

process.on("uncaughtException", (error) => {
  console.error("[hotkey-bridge] uncaught (keeping process alive if possible):", error);
});

main().catch((error) => {
  console.error("[hotkey-bridge] failed to start:", error);
  process.exit(1);
});
