import { describe, it, expect } from "vitest";
import {
  decideDisableToggle,
  formatEntryCount,
} from "../src/lib/ai-trace/settings-log-ui";

describe("decideDisableToggle", () => {
  it("enables directly when the checkbox is checked", () => {
    expect(decideDisableToggle(true, 0)).toEqual({ action: "enable" });
    expect(decideDisableToggle(true, 42)).toEqual({ action: "enable" });
  });

  it("disables directly when unchecked and the log is empty", () => {
    expect(decideDisableToggle(false, 0)).toEqual({ action: "disable_direct" });
  });

  it("asks for confirmation when unchecked and the log has entries", () => {
    expect(decideDisableToggle(false, 1)).toEqual({
      action: "confirm_disable",
    });
    expect(decideDisableToggle(false, 50)).toEqual({
      action: "confirm_disable",
    });
  });
});

describe("formatEntryCount", () => {
  it("uses the singular for exactly one entry", () => {
    expect(formatEntryCount(1)).toBe("1 entry");
  });

  it("uses the plural otherwise", () => {
    expect(formatEntryCount(0)).toBe("0 entries");
    expect(formatEntryCount(2)).toBe("2 entries");
    expect(formatEntryCount(1500)).toBe("1500 entries");
  });
});
