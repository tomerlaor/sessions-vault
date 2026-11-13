import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchOpenRouterModels,
  filterOpenRouterModels,
  type OpenRouterModel,
} from "../../lib/openrouter";
import { fetchOpenRouterDecisionsModels } from "../../lib/openrouter-decisions";

const MAX_VISIBLE = 100;

// A decisions model (see src/lib/openrouter-decisions.ts) can't be used as
// a chat model, but it's still a valid thing to type into any of these
// pickers (lyrics model especially) — tagged so it's not mistaken for a
// regular chat model.
type PickerModel = OpenRouterModel & { isDecisions?: boolean };

interface Props {
  value: string;
  onChange: (modelId: string) => void;
  placeholder?: string;
}

export function OpenRouterModelPicker({ value, onChange, placeholder }: Props) {
  const [models, setModels] = useState<PickerModel[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState(value);
  const [openList, setOpenList] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.allSettled([
      fetchOpenRouterModels(),
      fetchOpenRouterDecisionsModels(),
    ]).then(([chat, decisions]) => {
      if (chat.status === "rejected" && decisions.status === "rejected") {
        setLoadFailed(true);
        return;
      }
      const chatModels = chat.status === "fulfilled" ? chat.value : [];
      const decisionsModels =
        decisions.status === "fulfilled" ? decisions.value : [];
      setModels(
        [
          ...chatModels.map((m) => ({ ...m, isDecisions: false })),
          ...decisionsModels.map((m) => ({ ...m, isDecisions: true })),
        ].sort((a, b) => a.id.localeCompare(b.id)),
      );
    });
  }, []);

  useEffect(() => setQuery(value), [value]);

  useEffect(() => {
    if (!openList) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenList(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openList]);

  const matches = useMemo(
    () => filterOpenRouterModels(models, query),
    [models, query],
  );

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <input
        className="notes-area"
        placeholder={
          placeholder ??
          (loadFailed
            ? "Model ID (e.g. anthropic/claude-sonnet-4.6)"
            : "Search models or type an ID…")
        }
        value={query}
        onFocus={() => setOpenList(true)}
        onChange={(e) => {
          // Typing only searches; the model is saved on pick or blur.
          setQuery(e.target.value);
          setOpenList(true);
        }}
        onBlur={() => {
          const typed = query.trim();
          if (typed === value) return;
          const known = models.some((m) => m.id === typed);
          // Accept a hand-typed ID if it's in the catalog, if it's cleared,
          // or if the catalog couldn't load (offline). Otherwise it was just
          // a search, so revert instead of saving a bogus model ID.
          if (known || typed === "" || (loadFailed && typed.includes("/"))) {
            onChange(typed);
          } else {
            setQuery(value);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches.length > 0) {
            e.preventDefault();
            setQuery(matches[0].id);
            onChange(matches[0].id);
            setOpenList(false);
          }
        }}
        style={{
          width: "100%",
          fontSize: 11,
          padding: "6px 8px",
          height: "auto",
          fontFamily: "var(--font-mono)",
        }}
      />
      {openList && models.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 10,
            maxHeight: 220,
            overflowY: "auto",
            background: "var(--bg-2)",
            border: "1px solid var(--line-2)",
            borderRadius: 6,
            marginTop: 2,
          }}
        >
          {matches.length === 0 && (
            <div style={{ padding: 8, fontSize: 11, color: "var(--text-3)" }}>
              No matching models — the typed ID will be used as-is.
            </div>
          )}
          {matches.slice(0, MAX_VISIBLE).map((m) => (
            <div
              key={m.id}
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(m.id);
                onChange(m.id);
                setOpenList(false);
              }}
              style={{
                padding: "5px 8px",
                cursor: "pointer",
                background: m.id === value ? "var(--bg-3)" : undefined,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {m.id}
                {m.isDecisions && (
                  <span
                    style={{
                      fontSize: 9,
                      fontFamily: "var(--font-sans)",
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: "var(--accent)",
                      border: "1px solid var(--accent)",
                      borderRadius: 3,
                      padding: "0 4px",
                    }}
                  >
                    decisions
                  </span>
                )}
              </div>
              {m.name !== m.id && (
                <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                  {m.name}
                </div>
              )}
            </div>
          ))}
          {matches.length > MAX_VISIBLE && (
            <div style={{ padding: 8, fontSize: 10, color: "var(--text-3)" }}>
              Showing {MAX_VISIBLE} of {matches.length} — keep typing to narrow
              down.
            </div>
          )}
        </div>
      )}
      {loadFailed && (
        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>
          Couldn't load the model list (offline?). Type a model ID manually.
        </div>
      )}
    </div>
  );
}
