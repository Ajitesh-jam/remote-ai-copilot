import { describe, expect, it } from "vitest";
import { toHotkeyString } from "../../apps/mac-agent/src/keyboard/shortcuts.js";

describe("toHotkeyString", () => {
  it("maps Command+Option+P", () => {
    expect(toHotkeyString("Command+Option+P")).toBe("cmd+alt+p");
  });

  it("maps Control+Shift+H", () => {
    expect(toHotkeyString("Control+Shift+H")).toBe("ctrl+shift+h");
  });
});
