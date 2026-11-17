// Focus-trap and focus-restore helpers for modal dialogs. Kept dependency-free
// (plain objects with a `focus()` method) so they can be unit-tested without
// a DOM — see tests/cloud-consent-modal.test.ts.

export interface FocusableLike {
  focus: () => void;
}

// Cycles Tab/Shift+Tab between the first and last focusable element so focus
// never escapes the dialog. No-ops when there's nothing focusable or the key
// isn't Tab.
export function handleTabTrap(
  e: { key: string; shiftKey: boolean; preventDefault: () => void },
  focusables: FocusableLike[],
  active: FocusableLike | null,
): void {
  if (e.key !== "Tab" || focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey) {
    if (active === first || active === null) {
      e.preventDefault();
      last.focus();
    }
  } else if (active === last) {
    e.preventDefault();
    first.focus();
  }
}

export interface DetachableLike {
  isConnected?: boolean;
  focus: () => void;
}

// Restores focus to whatever had it before the dialog opened. No-ops if the
// node was removed from the document in the meantime (isConnected === false).
export function restoreFocus(el: DetachableLike | null | undefined): void {
  if (el && el.isConnected !== false) {
    el.focus();
  }
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
}
