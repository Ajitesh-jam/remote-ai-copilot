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
import { runTyping } from "./execution/type-text.js";

export class AgentSession {
  readonly sessionId: string;
  readonly startedAt: number;
  readonly logger: CopilotLogger;
  readonly state: AgentStateMachine;
  readonly execution = new ExecutionController();

  browser: BrowserAdapter;
  draftProvider: DraftProvider;

  private draft: DraftResult | null = null;
  private remainingText: string | null = null;
  private typedOffset = 0;
  private snapshot: PrepareSnapshot | null = null;
  private lastContext: PageContext | null = null;
  private lastError: string | null = null;
  private lastSuccessfulAction: string | null = null;
  private taskId: string | null = null;
  private locked = false;
  private lastResolvedInstruction: string | null = null;

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
      remainingPreview: this.remainingText,
      canResume: this.state.getState() === "HALTED" && !!this.remainingText?.length,
      lastError: this.lastError,
      lastSuccessfulAction: this.lastSuccessfulAction,
      taskId: this.taskId,
      shortcuts: this.config.shortcuts,
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
    resolvedInstruction: string;
  }> {
    if (this.locked) {
      throw new Error("Agent is locked");
    }
    // New PREPARE cancels previous work (including resume remainder)
    this.execution.halt();
    this.remainingText = null;
    this.typedOffset = 0;

    const result = await runPrepare({
      browser: this.browser,
      draftProvider: this.draftProvider,
      state: this.state,
      execution: this.execution,
      logger: this.logger.child("execution"),
      instruction,
    });
    this.draft = result.draft;
    this.remainingText = result.draft.draft;
    this.typedOffset = 0;
    this.snapshot = result.snapshot;
    this.lastContext = result.context;
    this.lastResolvedInstruction = result.resolvedInstruction;
    this.taskId = result.taskId;
    this.lastError = null;
    this.lastSuccessfulAction = new Date().toISOString();
    this.notify(
      "Draft ready — press GO",
      result.draft.draft.slice(0, 180) + (result.draft.draft.length > 180 ? "…" : "")
    );
    return {
      draft: result.draft.draft,
      explanation: result.draft.explanation,
      context: result.context,
      resolvedInstruction: result.resolvedInstruction,
    };
  }

  async go(): Promise<{ typed: boolean; warning?: string; remaining?: string }> {
    if (this.locked) {
      throw new Error("Agent is locked");
    }
    if (!this.draft || !this.snapshot) {
      throw new Error("No prepared draft — press PREPARE first");
    }
    if (!this.config.agent.requireGo) {
      throw new Error("requireGo must remain true");
    }

    const text = this.remainingText ?? this.draft.draft;
    const baseOffset = this.typedOffset;
    const replace = this.config.agent.replaceFocusedOnGo && this.typedOffset === 0;

    // Live progress so HALT status can report remaining immediately
    const trackProgress = (n: number) => {
      this.typedOffset = baseOffset + n;
      this.remainingText = text.slice(n);
    };

    const result = await runTyping({
      browser: this.browser,
      state: this.state,
      execution: this.execution,
      logger: this.logger.child("execution"),
      text,
      snapshot: this.snapshot,
      replace,
      allowAutomaticSubmission: this.config.agent.allowAutomaticSubmission,
      reason: "GO",
      onProgress: trackProgress,
    });

    this.typedOffset = baseOffset + result.typedChars;
    this.remainingText = result.remaining || null;

    if (result.warning) {
      this.lastError = result.warning;
      this.notify("Typing paused / cancelled", result.warning.slice(0, 200));
    } else if (result.typed) {
      this.lastError = null;
      this.remainingText = null;
      this.lastSuccessfulAction = new Date().toISOString();
      this.notify("Typing complete", "Draft inserted.");
    }
    return {
      typed: result.typed,
      warning: result.warning,
      remaining: result.remaining,
    };
  }

  async resume(): Promise<{ typed: boolean; warning?: string; remaining?: string }> {
    if (this.locked) {
      throw new Error("Agent is locked");
    }
    if (this.state.getState() !== "HALTED") {
      throw new Error(`RESUME only when HALTED (current: ${this.state.getState()})`);
    }
    if (!this.remainingText?.length || !this.snapshot) {
      throw new Error("Nothing to resume — press PREPARE then GO first");
    }

    this.logger.child("keyboard").event("HOTKEY_RESUME", "STARTED");

    const text = this.remainingText;
    const baseOffset = this.typedOffset;
    const trackProgress = (n: number) => {
      this.typedOffset = baseOffset + n;
      this.remainingText = text.slice(n);
    };

    const result = await runTyping({
      browser: this.browser,
      state: this.state,
      execution: this.execution,
      logger: this.logger.child("execution"),
      text,
      snapshot: this.snapshot,
      replace: false,
      allowAutomaticSubmission: this.config.agent.allowAutomaticSubmission,
      reason: "RESUME",
      onProgress: trackProgress,
    });

    this.typedOffset = baseOffset + result.typedChars;
    this.remainingText = result.remaining || null;

    if (result.warning) {
      this.lastError = result.warning;
      this.notify("Resume paused", result.warning.slice(0, 200));
    } else if (result.typed) {
      this.lastError = null;
      this.remainingText = null;
      this.lastSuccessfulAction = new Date().toISOString();
      this.notify("Resume complete", "Finished inserting the remaining draft.");
    }
    return {
      typed: result.typed,
      warning: result.warning,
      remaining: result.remaining,
    };
  }

  halt(): void {
    this.logger.child("execution").event("HALT_RECEIVED", "STARTED");
    this.logger.child("keyboard").event("HOTKEY_HALT", "SUCCESS");
    this.execution.halt();
    void this.browser.stop();
    this.state.force("HALTED", "user HALT");
    this.logger.child("agent").event("AGENT_HALTED", "SUCCESS", {
      details: {
        remainingLength: this.remainingText?.length ?? 0,
        canResume: !!(this.remainingText && this.remainingText.length > 0),
      },
    });
    this.notify(
      "HALTED",
      this.remainingText?.length
        ? "Paused. Press RESUME to continue, or PREPARE to start over."
        : "Stopped. Draft preserved if available."
    );
  }

  lock(): void {
    this.locked = true;
    this.halt();
  }

  unlock(): void {
    this.locked = false;
    if (this.state.getState() === "HALTED" || this.state.getState() === "DISCONNECTED") {
      if (this.browser.isConnected() && !this.remainingText) {
        this.state.force("IDLE", "unlocked");
      }
    }
  }

  getDraft(): DraftResult | null {
    return this.draft;
  }

  getRemaining(): string | null {
    return this.remainingText;
  }

  getLastContext(): PageContext | null {
    return this.lastContext;
  }

  getLastInstruction(): string | null {
    return this.lastResolvedInstruction;
  }

  setLastError(message: string): void {
    this.lastError = message;
  }
}

export type { TabInfo };
