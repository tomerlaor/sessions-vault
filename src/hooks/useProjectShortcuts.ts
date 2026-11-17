import { useEffect } from "react";
import {
  resolveShortcut,
  type ShortcutAction,
  type ShortcutEventLike,
} from "../lib/project-tabs";

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform ?? "");

/** Wires the project view's keyboard shortcuts (tab switches, Cmd+O, Esc,
 * Cmd+[ / Cmd+], E, T, Cmd+Shift+C) to a single dispatch callback. Inactive
 * while typing, except Escape and Cmd+O (see `resolveShortcut`). */
export function useProjectShortcuts(
  dispatch: (action: ShortcutAction) => void,
  enabled: boolean = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const action = resolveShortcut(e as unknown as ShortcutEventLike, IS_MAC);
      if (!action) return;
      e.preventDefault();
      dispatch(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, enabled]);
}
