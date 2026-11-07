#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  watch,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { loadConfig, getRepoRoot } from "../config.js";
import { api, readPidInfo, resolveFixture } from "./client.js";

const program = new Command();
program.name("copilot").description("Remote AI Browser Copilot CLI").version("0.1.0");

function agentEntry(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distEntry = path.resolve(here, "../index.js");
  const srcEntry = path.resolve(here, "../index.ts");
  if (existsSync(distEntry)) return distEntry;
  return srcEntry;
}

program
  .command("start")
  .description("Start the local agent daemon")
  .option("--foreground", "Run in the foreground", false)
  .action(async (opts: { foreground?: boolean }) => {
    const existing = readPidInfo();
    if (existing) {
      try {
        process.kill(existing.pid, 0);
        console.log(`Agent already running (pid ${existing.pid}) on ${existing.host}:${existing.port}`);
        return;
      } catch {
        // stale pid file
      }
    }

    const entry = agentEntry();
    const isTs = entry.endsWith(".ts");
    const args = isTs ? ["--import", "tsx", entry] : [entry];

    if (opts.foreground) {
      const child = spawn(process.execPath, args, {
        stdio: "inherit",
        cwd: getRepoRoot(),
        env: process.env,
      });
      child.on("exit", (code) => process.exit(code ?? 0));
      return;
    }

    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      cwd: getRepoRoot(),
      env: process.env,
    });
    child.unref();

    // Wait briefly for pid file
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const info = readPidInfo();
      if (info) {
        console.log(`Agent started (pid ${info.pid}) at http://${info.host}:${info.port}`);
        return;
      }
    }
    console.log(`Agent spawn requested (child pid ${child.pid}). Waiting for health…`);
    try {
      const health = await api<{ ok: boolean }>("GET", "/health");
      console.log("Health:", health);
    } catch (error) {
      console.error("Agent may still be starting:", error instanceof Error ? error.message : error);
    }
  });

program
  .command("stop")
  .description("Stop the local agent")
  .action(async () => {
    const info = readPidInfo();
    try {
      await api("POST", "/api/shutdown");
      console.log("Shutdown requested");
    } catch {
      if (info) {
        try {
          process.kill(info.pid, "SIGTERM");
          console.log(`Sent SIGTERM to pid ${info.pid}`);
        } catch {
          console.log("Agent not running");
        }
      } else {
        console.log("Agent not running");
      }
    }
  });

program
  .command("status")
  .description("Show agent status")
  .action(async () => {
    const info = readPidInfo();
    if (!info) {
      console.log("Agent not running (no pid file)");
      return;
    }
    try {
      const status = await api("GET", "/api/status");
      console.log(JSON.stringify({ pidInfo: info, status }, null, 2));
    } catch (error) {
      console.log("Pid file present but agent unreachable:", info);
      console.error(error instanceof Error ? error.message : error);
    }
  });

program
  .command("logs")
  .description("Show agent logs")
  .option("--live", "Tail logs", false)
  .option("--last <n>", "Show last N lines", "100")
  .action(async (opts: { live?: boolean; last: string }) => {
    const config = loadConfig();
    const logFile = path.join(config.logging.logDirectory, "agent.log");
    if (!existsSync(logFile)) {
      console.log(`No log file at ${logFile}`);
      return;
    }
    const content = readFileSync(logFile, "utf8");
    const lines = content.trimEnd().split("\n");
    const n = Number(opts.last) || 100;
    console.log(lines.slice(-n).join("\n"));
    if (!opts.live) return;

    let offset = Buffer.byteLength(content);
    watch(logFile, () => {
      try {
        const buf = readFileSync(logFile);
        if (buf.length < offset) offset = 0;
        const chunk = buf.subarray(offset).toString("utf8");
        offset = buf.length;
        if (chunk) process.stdout.write(chunk);
      } catch {
        // ignore
      }
    });
    console.error("(live) Ctrl+C to stop");
    await new Promise(() => undefined);
  });

program
  .command("halt")
  .description("Emergency stop typing / browser actions")
  .action(async () => {
    const result = await api("POST", "/api/halt");
    console.log(result);
  });

const browser = program.command("browser").description("Browser tools");

browser
  .command("connect")
  .description("Connect / launch Playwright browser")
  .action(async () => {
    console.log(await api("POST", "/api/browser/connect"));
  });

browser
  .command("disconnect")
  .description("Disconnect browser")
  .action(async () => {
    console.log(await api("POST", "/api/browser/disconnect"));
  });

browser
  .command("tabs")
  .description("List browser tabs")
  .action(async () => {
    console.log(JSON.stringify(await api("GET", "/api/browser/tabs"), null, 2));
  });

browser
  .command("select")
  .argument("<tab-id>", "Tab id")
  .description("Select a tab")
  .action(async (tabId: string) => {
    console.log(
      JSON.stringify(
        await api("POST", "/api/browser/select", { tabId: Number(tabId) }),
        null,
        2
      )
    );
  });

browser
  .command("open")
  .argument("<url>", "URL or file path")
  .description("Navigate active tab")
  .action(async (url: string) => {
    let target = url;
    if (!/^https?:\/\//i.test(url) && !url.startsWith("file:")) {
      const abs = path.isAbsolute(url) ? url : resolveFixture(url);
      target = `file://${abs}`;
    }
    console.log(JSON.stringify(await api("POST", "/api/browser/open", { url: target }), null, 2));
  });

browser
  .command("read")
  .description("Read structured page context")
  .action(async () => {
    console.log(JSON.stringify(await api("GET", "/api/browser/read"), null, 2));
  });

browser
  .command("text")
  .description("Get visible text")
  .action(async () => {
    console.log(JSON.stringify(await api("GET", "/api/browser/text"), null, 2));
  });

browser
  .command("focus")
  .description("Inspect focused element")
  .action(async () => {
    console.log(JSON.stringify(await api("GET", "/api/browser/focus"), null, 2));
  });

browser
  .command("a11y")
  .description("Dump accessibility tree")
  .action(async () => {
    console.log(JSON.stringify(await api("GET", "/api/browser/a11y"), null, 2));
  });

browser
  .command("elements")
  .description("List interactive elements")
  .action(async () => {
    console.log(JSON.stringify(await api("GET", "/api/browser/elements"), null, 2));
  });

browser
  .command("url")
  .description("Get current URL")
  .action(async () => {
    console.log(JSON.stringify(await api("GET", "/api/browser/url"), null, 2));
  });

browser
  .command("screenshot")
  .option("-o, --out <path>", "Output path", "logs/screenshot.png")
  .description("Capture screenshot")
  .action(async (opts: { out: string }) => {
    const buf = await api<Buffer>("GET", "/api/browser/screenshot");
    const outPath = path.isAbsolute(opts.out)
      ? opts.out
      : path.join(getRepoRoot(), opts.out);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, buf);
    console.log(`Wrote ${outPath} (${buf.length} bytes)`);
  });

browser
  .command("type")
  .argument("<text>", "Text to insert")
  .description("Manually type into focused element (explicit authorization)")
  .action(async (text: string) => {
    console.log(await api("POST", "/api/browser/type", { text }));
  });

program
  .command("prepare")
  .description("Capture context and generate draft (no typing)")
  .option("-i, --instruction <text>", "One-time instruction")
  .action(async (opts: { instruction?: string }) => {
    const result = await api("POST", "/api/prepare", {
      instruction: opts.instruction,
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("go")
  .description("Type the prepared draft into the focused field")
  .action(async () => {
    console.log(JSON.stringify(await api("POST", "/api/go"), null, 2));
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
