import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import pino, { type Logger } from "pino";
import type { LogEvent, LogStatus } from "@remote-ai-copilot/shared-types";
import { redactRecord } from "./redaction.js";

export { redactRecord, redactValue } from "./redaction.js";

export interface CopilotLoggerOptions {
  sessionId: string;
  level?: string;
  logDirectory?: string;
  redactContent?: boolean;
  pretty?: boolean;
}

export interface CopilotLogger {
  sessionId: string;
  raw: Logger;
  child(component: string): ComponentLogger;
  event(
    component: string,
    event: string,
    status: LogStatus,
    opts?: {
      taskId?: string;
      durationMs?: number;
      details?: Record<string, unknown>;
      error?: { message: string; code?: string };
    }
  ): LogEvent;
}

export interface ComponentLogger {
  event(
    event: string,
    status: LogStatus,
    opts?: {
      taskId?: string;
      durationMs?: number;
      details?: Record<string, unknown>;
      error?: { message: string; code?: string };
    }
  ): LogEvent;
  info(msg: string, details?: Record<string, unknown>): void;
  warn(msg: string, details?: Record<string, unknown>): void;
  error(msg: string, details?: Record<string, unknown>): void;
}

export function createLogger(options: CopilotLoggerOptions): CopilotLogger {
  const logDirectory = options.logDirectory ?? "./logs";
  mkdirSync(logDirectory, { recursive: true });

  const redactContent = options.redactContent ?? true;
  const level = options.level ?? "info";

  const targets: pino.TransportTargetOptions[] = [
    {
      target: "pino/file",
      options: { destination: path.join(logDirectory, "agent.log"), mkdir: true },
      level,
    },
  ];

  if (options.pretty !== false) {
    targets.push({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname",
      },
      level,
    });
  }

  const raw = pino(
    {
      level,
      base: { sessionId: options.sessionId },
    },
    pino.transport({ targets })
  );

  const logger: CopilotLogger = {
    sessionId: options.sessionId,
    raw,
    child(component: string): ComponentLogger {
      const childRaw = raw.child({ component });
      return {
        event(event, status, opts) {
          return logger.event(component, event, status, opts);
        },
        info(msg, details) {
          childRaw.info(redactRecord(details, redactContent) ?? {}, msg);
        },
        warn(msg, details) {
          childRaw.warn(redactRecord(details, redactContent) ?? {}, msg);
        },
        error(msg, details) {
          childRaw.error(redactRecord(details, redactContent) ?? {}, msg);
        },
      };
    },
    event(component, event, status, opts = {}) {
      const logEvent: LogEvent = {
        timestamp: new Date().toISOString(),
        eventId: randomUUID(),
        sessionId: options.sessionId,
        taskId: opts.taskId,
        component,
        event,
        status,
        durationMs: opts.durationMs,
        details: redactRecord(opts.details, redactContent),
        error: opts.error,
      };

      const levelName =
        status === "FAILED" ? "error" : status === "CANCELLED" ? "warn" : "info";
      raw[levelName](
        {
          component,
          event,
          status,
          taskId: opts.taskId,
          durationMs: opts.durationMs,
          details: logEvent.details,
          error: opts.error,
        },
        event
      );

      return logEvent;
    },
  };

  return logger;
}
