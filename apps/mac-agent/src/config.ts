import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CopilotConfig } from "@remote-ai-copilot/shared-types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function deepMerge(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const current = result[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      result[key] = deepMerge(
        current as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function findRepoRoot(): string {
  let dir = path.resolve(__dirname, "../../..");
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "config", "default.json"))) {
      return dir;
    }
    dir = path.resolve(dir, "..");
  }
  return path.resolve(__dirname, "../../..");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CopilotConfig {
  const root = findRepoRoot();
  const defaultPath = path.join(root, "config", "default.json");
  const config = JSON.parse(readFileSync(defaultPath, "utf8")) as CopilotConfig;

  const nodeEnv = env.NODE_ENV ?? "development";
  const overlayPath = path.join(root, "config", `${nodeEnv}.json`);
  if (existsSync(overlayPath)) {
    const overlay = JSON.parse(readFileSync(overlayPath, "utf8")) as Record<string, unknown>;
    Object.assign(
      config,
      deepMerge(config as unknown as Record<string, unknown>, overlay)
    );
  }

  if (env.COPILOT_HOST) config.agent.host = env.COPILOT_HOST;
  if (env.COPILOT_PORT) config.agent.port = Number(env.COPILOT_PORT);

  // Resolve log directory relative to repo root
  if (!path.isAbsolute(config.logging.logDirectory)) {
    config.logging.logDirectory = path.join(root, config.logging.logDirectory);
  }

  return config;
}

export function getRepoRoot(): string {
  return findRepoRoot();
}

export function getPidFilePath(config: CopilotConfig): string {
  return path.join(config.logging.logDirectory, "agent.pid");
}
