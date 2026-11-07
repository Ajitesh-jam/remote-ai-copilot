/**
 * WebSocket protocol shapes (Phase 6). Kept minimal for Phases 1–2.
 */
import type { DraftResult, PageContext } from "@remote-ai-copilot/shared-types";

export type ProtocolMessageType =
  | "prepare.request"
  | "prepare.response"
  | "cancel"
  | "heartbeat"
  | "event";

export interface PrepareRequestMessage {
  type: "prepare.request";
  taskId: string;
  instruction: string;
  context: PageContext;
}

export interface PrepareResponseMessage {
  type: "prepare.response";
  taskId: string;
  result: DraftResult;
}

export interface HeartbeatMessage {
  type: "heartbeat";
  ts: string;
}

export type ProtocolMessage =
  | PrepareRequestMessage
  | PrepareResponseMessage
  | HeartbeatMessage
  | { type: "cancel"; taskId: string }
  | { type: "event"; event: string; details?: Record<string, unknown> };
