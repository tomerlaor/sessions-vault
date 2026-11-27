// Pure decision logic for the "Keep AI activity log" row in Settings → AI
// Assistant (tracing T2, #90) — kept free of React so it can be unit
// tested directly, without a component-test harness.

export type DisableToggleDecision =
  | { action: "enable" }
  | { action: "disable_direct" }
  | { action: "confirm_disable" };

// What unchecking "Keep AI activity log" should do: when the log is
// already empty there's nothing to confirm, so it turns off immediately;
// otherwise the row must show "Turn off and delete N entries?" first.
export function decideDisableToggle(
  nextChecked: boolean,
  count: number,
): DisableToggleDecision {
  if (nextChecked) return { action: "enable" };
  return count > 0
    ? { action: "confirm_disable" }
    : { action: "disable_direct" };
}

// "Turn off and delete N entries?" — singular only for exactly one.
export function formatEntryCount(count: number): string {
  return count === 1 ? "1 entry" : `${count} entries`;
}
