import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadConfig, getPidFilePath, getRepoRoot } from "../config.js";

export interface PidInfo {
  pid: number;
  port: number;
  host: string;
  sessionId: string;
  startedAt: string;
}

export function readPidInfo(): PidInfo | null {
  const config = loadConfig();
  const pidFile = getPidFilePath(config);
  if (!existsSync(pidFile)) return null;
  try {
    return JSON.parse(readFileSync(pidFile, "utf8")) as PidInfo;
  } catch {
    return null;
  }
}

export function baseUrlFromPid(): string {
  const info = readPidInfo();
  if (info) return `http://${info.host}:${info.port}`;
  const config = loadConfig();
  return `http://${config.agent.host}:${config.agent.port}`;
}

export async function api<T = unknown>(
  method: string,
  route: string,
  body?: unknown
): Promise<T> {
  const url = `${baseUrlFromPid()}${route}`;
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${route} failed: ${res.status} ${text}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  if (contentType.includes("image/")) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf as unknown as T;
  }
  return (await res.text()) as unknown as T;
}

export function resolveFixture(relative: string): string {
  return path.join(getRepoRoot(), relative);
}
