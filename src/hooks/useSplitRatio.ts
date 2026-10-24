import { useState, useCallback } from "react";
import { parseStoredSplit } from "../lib/project-view";

const STORAGE_KEY = "sessions.projectSplit";

function readStored(): number {
  try {
    return parseStoredSplit(localStorage.getItem(STORAGE_KEY));
  } catch {
    return parseStoredSplit(null);
  }
}

/** Remembered share of the split view given to the first pane. */
export function useSplitRatio(): [number, (r: number) => void] {
  const [ratio, setRatioState] = useState<number>(readStored);

  const setRatio = useCallback((r: number) => {
    setRatioState(r);
    try {
      localStorage.setItem(STORAGE_KEY, String(r));
    } catch {
      /* storage unavailable; keep in-memory value */
    }
  }, []);

  return [ratio, setRatio];
}
