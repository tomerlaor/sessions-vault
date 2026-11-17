import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CloudConsentDialog from "../src/components/shared/CloudConsentDialog";
import CloudConsentSection from "../src/components/settings/CloudConsentSection";
import {
  handleTabTrap,
  restoreFocus,
  type FocusableLike,
  type DetachableLike,
} from "../src/lib/dialog-focus";

function renderDialog(overrides: Record<string, unknown> = {}) {
  const props = {
    title: "Send lyrics to OpenAI?",
    intro: "Every suggestion request sends:",
    sentItems: ["Your full lyrics draft", "The song title"],
    provider: "openai",
    localProvider: "ollama",
    onUseCloud: () => {},
    onSwitchToLocal: () => {},
    onDismiss: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(createElement(CloudConsentDialog, props));
}

describe("CloudConsentDialog markup", () => {
  it("includes a 'Not now' action and a close button", () => {
    const html = renderDialog();
    expect(html).toContain("Not now");
    expect(html).toContain('aria-label="Close"');
  });

  it("has dialog a11y attributes, with aria-labelledby pointing at the title", () => {
    const html = renderDialog();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const labelledBy = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`id="${labelledBy}"`);
  });

  it("explains that switching to local applies to all AI features", () => {
    const html = renderDialog();
    expect(html).toMatch(/all AI features/i);
    expect(html).toMatch(/Tab Agent/);
    expect(html).toMatch(/lyrics helper/i);
  });
});

describe("CloudConsentSection markup", () => {
  it("lists both features and shows Revoke only when granted", () => {
    const html = renderToStaticMarkup(
      createElement(CloudConsentSection, {
        lyricsProvider: "openai",
        lyricsGrantedAt: 1700000000000,
        tabAgentProvider: undefined,
        tabAgentGrantedAt: undefined,
        onRevokeLyrics: () => {},
        onRevokeTabAgent: () => {},
      }),
    );
    expect(html).toContain("Lyrics helper");
    expect(html).toContain("Tab Agent");
    expect(html).toContain("Granted for OpenAI");
    expect(html).toContain("Not granted");
    expect(html.match(/Revoke/g)?.length).toBe(1);
  });

  it("shows no Revoke button when neither feature has consent", () => {
    const html = renderToStaticMarkup(
      createElement(CloudConsentSection, {
        onRevokeLyrics: () => {},
        onRevokeTabAgent: () => {},
      }),
    );
    expect(html).not.toContain("Revoke");
    expect(html.match(/Not granted/g)?.length).toBe(2);
  });

  it("shows Revoke for both features when both are granted", () => {
    const html = renderToStaticMarkup(
      createElement(CloudConsentSection, {
        lyricsProvider: "anthropic",
        lyricsGrantedAt: 1700000000000,
        tabAgentProvider: "openrouter",
        tabAgentGrantedAt: 1700000000000,
        onRevokeLyrics: () => {},
        onRevokeTabAgent: () => {},
      }),
    );
    expect(html.match(/Revoke/g)?.length).toBe(2);
  });
});

describe("handleTabTrap", () => {
  function makeFocusable(): FocusableLike & { focused: boolean } {
    const el = { focused: false, focus: () => {} };
    el.focus = () => {
      el.focused = true;
    };
    return el;
  }

  it("wraps Shift+Tab from the first element to the last", () => {
    const first = makeFocusable();
    const last = makeFocusable();
    const preventDefault = vi.fn();
    handleTabTrap(
      { key: "Tab", shiftKey: true, preventDefault },
      [first, last],
      first,
    );
    expect(preventDefault).toHaveBeenCalled();
    expect(last.focused).toBe(true);
  });

  it("wraps Tab from the last element to the first", () => {
    const first = makeFocusable();
    const last = makeFocusable();
    const preventDefault = vi.fn();
    handleTabTrap(
      { key: "Tab", shiftKey: false, preventDefault },
      [first, last],
      last,
    );
    expect(preventDefault).toHaveBeenCalled();
    expect(first.focused).toBe(true);
  });

  it("does nothing for a middle element or a non-Tab key", () => {
    const first = makeFocusable();
    const middle = makeFocusable();
    const last = makeFocusable();
    const preventDefault = vi.fn();
    handleTabTrap(
      { key: "Tab", shiftKey: false, preventDefault },
      [first, middle, last],
      middle,
    );
    expect(preventDefault).not.toHaveBeenCalled();
    expect(first.focused).toBe(false);
    expect(last.focused).toBe(false);

    handleTabTrap(
      { key: "Enter", shiftKey: false, preventDefault },
      [first, last],
      last,
    );
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("does nothing when there are no focusable elements", () => {
    const preventDefault = vi.fn();
    handleTabTrap({ key: "Tab", shiftKey: false, preventDefault }, [], null);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe("restoreFocus", () => {
  it("focuses a still-connected node", () => {
    const el: DetachableLike = { isConnected: true, focus: vi.fn() };
    restoreFocus(el);
    expect(el.focus).toHaveBeenCalled();
  });

  it("treats a missing isConnected flag as connected", () => {
    const el: DetachableLike = { focus: vi.fn() };
    restoreFocus(el);
    expect(el.focus).toHaveBeenCalled();
  });

  it("is a no-op when the node was detached", () => {
    const el: DetachableLike = { isConnected: false, focus: vi.fn() };
    restoreFocus(el);
    expect(el.focus).not.toHaveBeenCalled();
  });

  it("is a no-op for null/undefined", () => {
    expect(() => restoreFocus(null)).not.toThrow();
    expect(() => restoreFocus(undefined)).not.toThrow();
  });
});
