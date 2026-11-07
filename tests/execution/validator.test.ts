import { describe, expect, it } from "vitest";
import { validateTypingTarget } from "../../apps/mac-agent/src/execution/validator.js";
import type { PrepareSnapshot } from "@remote-ai-copilot/shared-types";

const snapshot: PrepareSnapshot = {
  tabId: 1,
  url: "file:///test.html",
  title: "Test",
  focusedFingerprint: "textarea||reply|||||",
  focusedSummary: "textarea placeholder=\"Type your reply here…\"",
  capturedAt: new Date().toISOString(),
};

describe("validateTypingTarget", () => {
  it("passes when tab and fingerprint match", () => {
    const result = validateTypingTarget(snapshot, 1, snapshot.url, {
      tag: "textarea",
      tagName: "textarea",
      fingerprint: snapshot.focusedFingerprint!,
    });
    expect(result.ok).toBe(true);
  });

  it("fails when focus changes", () => {
    const result = validateTypingTarget(snapshot, 1, snapshot.url, {
      tag: "input",
      tagName: "input",
      type: "search",
      fingerprint: "input|search|search|||||",
    });
    expect(result.ok).toBe(false);
    expect(result.warning).toContain("focused browser element has changed");
  });

  it("fails when tab changes", () => {
    const result = validateTypingTarget(snapshot, 2, "https://example.com", {
      tag: "textarea",
      tagName: "textarea",
      fingerprint: snapshot.focusedFingerprint!,
    });
    expect(result.ok).toBe(false);
    expect(result.warning).toContain("active browser tab has changed");
  });

  it("refuses password fields", () => {
    const pwSnapshot = {
      ...snapshot,
      focusedFingerprint: "input|password||||||",
    };
    const result = validateTypingTarget(pwSnapshot, 1, snapshot.url, {
      tag: "input",
      tagName: "input",
      type: "password",
      fingerprint: "input|password||||||",
    });
    expect(result.ok).toBe(false);
    expect(result.warning).toContain("password");
  });
});
