import { randomUUID } from "node:crypto";
import notifier from "node-notifier";
import type {
  AgentStatus,
  CopilotConfig,
  DraftResult,
  PageContext,
  PrepareSnapshot,
  TabInfo,
} from "@remote-ai-copilot/shared-types";
import { createLogger, type CopilotLogger } from "@remote-ai-copilot/logger";
import { AgentStateMachine } from "./agent-state.js";
import type { BrowserAdapter } from "./browser/adapter.js";
import { PlaywrightAdapter } from "./browser/playwright-adapter.js";
import {
  HttpDraftProvider,
  StubDraftProvider,
  type DraftProvider,
} from "./draft/provider.js";
import { ExecutionController } from "./execution/halt.js";
import { runPrepare } from "./execution/prepare.js";
import { runGo } from "./execution/type-text.js";

export class AgentSession {
  readonly sessionId: string;
  readonly startedAt: number;
  readonly logger: CopilotLogger;
  readonly state: AgentStateMachine;
  readonly execution = new ExecutionController();

  browser: BrowserAdapter;
  draftProvider: DraftProvider;

  private draft: DraftResult | null = null;
  private snapshot: PrepareSnapshot | null = null;
  private lastContext: PageContext | null = null;
  private lastError: string | null = null;
  private lastSuccessfulAction: string | null = null;
  private taskId: string | null = null;
  private locked = false;

  constructor(private readonly config: CopilotConfig) {
    this.sessionId = randomUUID();
    this.startedAt = Date.now();
    this.logger = createLogger({
      sessionId: this.sessionId,
      level: config.logging.level,
      logDirectory: config.logging.logDirectory,
      redactContent: config.logging.redactContent,
    });
    this.state = new AgentStateMachine(this.logger.child("agent"));
    this.browser = new PlaywrightAdapter(config, this.logger.child("browser"));
    this.draftProvider =
      config.agent.draftProvider === "http"
        ? new HttpDraftProvider("http://127.0.0.1:4000/api/session/prepare")
        : new StubDraftProvider();
  }

  getConfig(): CopilotConfig {
    return this.config;
  }

  notify(title: string, message: string): void {
    try {
      notifier.notify({ title, message, sound: false });
    } catch {
      // notifications are best-effort
    }
  }

  getStatus(): AgentStatus {
    return {
      state: this.state.getState(),
      sessionId: this.sessionId,
      pid: process.pid,
      uptimeMs: Date.now() - this.startedAt,
      browserConnected: this.browser.isConnected(),
      activeTab: null,
      draftPreview: this.draft?.draft ?? null,
      draftExplanation: this.draft?.explanation ?? null,
      lastError: this.lastError,
      lastSuccessfulAction: this.lastSuccessfulAction,
      taskId: this.taskId,
    };
  }

  async getStatusAsync(): Promise<AgentStatus> {
    const status = this.getStatus();
    if (this.browser.isConnected()) {
      try {
        status.activeTab = await this.browser.getActiveTab();
      } catch {
        status.activeTab = null;
      }
    }
    return status;
  }

  async connectBrowser(): Promise<void> {
    await this.browser.connect();
    this.state.force("IDLE", "browser connected");
    this.lastSuccessfulAction = new Date().toISOString();
  }

  async disconnectBrowser(): Promise<void> {
    await this.browser.disconnect();
    this.state.force("DISCONNECTED", "browser disconnected");
  }

  async prepare(instruction?: string): Promise<{
    draft: string;
    explanation?: string;
    context: PageContext;
  }> {
    if (this.locked) {
      throw new Error("Agent is locked");
    }
    // Cancel any in-flight work and start fresh
    this.execution.halt();
    const result = await runPrepare({
      browser: this.browser,
      draftProvider: this.draftProvider,
      state: this.state,
      execution: this.execution,
      logger: this.logger.child("execution"),
      instruction,
    });
    this.draft = result.draft;
    this.snapshot = result.snapshot;
    this.lastContext = result.context;
    this.taskId = result.taskId;
    this.lastError = null;
    this.lastSuccessfulAction = new Date().toISOString();
    this.notify(
      "Draft ready",
      result.draft.draft.slice(0, 180) + (result.draft.draft.length > 180 ? "…" : "")
    );
    return {
      draft: result.draft.draft,
      explanation: result.draft.explanation,
      context: result.context,
    };
  }

  async go(): Promise<{ typed: boolean; warning?: string }> {
    if (this.locked) {
      throw new Error("Agent is locked");
    }
    if (!this.draft || !this.snapshot) {
      throw new Error("No prepared draft — press PREPARE first");
    }
    if (!this.config.agent.requireGo) {
      throw new Error("requireGo must remain true");
    }

    const result = await runGo({
      browser: this.browser,
      state: this.state,
      execution: this.execution,
      logger: this.logger.child("execution"),
      draft: this.draft.draft,
      snapshot: this.snapshot,
      allowAutomaticSubmission: this.config.agent.allowAutomaticSubmission,
    });

    if (result.warning) {
      this.lastError = result.warning;
      this.notify("Typing cancelled", result.warning.slice(0, 200));
    } else if (result.typed) {
      this.lastError = null;
      this.lastSuccessfulAction = new Date().toISOString();
      this.notify("Typing complete", "Draft inserted into the focused field.");
    }
    return result;
  }

  halt(): void {
    this.logger.child("execution").event("HALT_RECEIVED", "STARTED");
    this.logger.child("keyboard").event("HOTKEY_HALT", "SUCCESS");
    this.execution.halt();
    void this.browser.stop();
    this.state.force("HALTED", "user HALT");
    this.logger.child("agent").event("AGENT_HALTED", "SUCCESS");
    this.notify("HALTED", "Execution stopped. Draft preserved.");
  }

  lock(): void {
    this.locked = true;
    this.halt();
  }

  unlock(): void {
    this.locked = false;
    if (this.state.getState() === "HALTED" || this.state.getState() === "DISCONNECTED") {
      if (this.browser.isConnected()) {
        this.state.force("IDLE", "unlocked");
      }
    }
  }

  getDraft(): DraftResult | null {
    return this.draft;
  }

  getLastContext(): PageContext | null {
    return this.lastContext;
  }

  setLastError(message: string): void {
    this.lastError = message;
  }
}

export type { TabInfo };
