import type { ElementInfo, PageContext, TabInfo } from "@remote-ai-copilot/shared-types";

export interface BrowserAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  getTabs(): Promise<TabInfo[]>;
  getActiveTab(): Promise<TabInfo>;
  selectTab(tabId: number): Promise<TabInfo>;
  openUrl(url: string): Promise<TabInfo>;

  getPageContext(): Promise<PageContext>;
  getVisibleText(): Promise<string>;
  getSelectedText(): Promise<string>;
  getInteractiveElements(): Promise<ElementInfo[]>;
  getAccessibilityTree(): Promise<unknown>;
  screenshot(): Promise<Buffer>;
  getFocusedElement(): Promise<ElementInfo | null>;

  insertText(text: string, signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
}
