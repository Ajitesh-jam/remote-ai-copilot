import { describe, expect, it } from "vitest";
import {
  parseCombo,
  toHotkeyString,
} from "../../apps/mac-agent/src/keyboard/shortcuts.js";

describe("toHotkeyString", () => {
  it("maps Command+Option+P", () => {
    expect(toHotkeyString("Command+Option+P")).toBe("cmd+alt+p");
  });

  it("maps Control+Shift+H", () => {
    expect(toHotkeyString("Control+Shift+H")).toBe("ctrl+shift+h");
  });
});

describe("parseCombo", () => {
  it("parses Command+Option+P", () => {
    expect(parseCombo("Command+Option+P")).toEqual({
      key: "p",
      meta: true,
      alt: true,
      ctrl: false,
      shift: false,
    });
  });
});
