import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchOpenRouterModels,
  filterOpenRouterModels,
  type OpenRouterModel,
} from "../../lib/openrouter";

const MAX_VISIBLE = 100;

interface Props {
  value: string;
  onChange: (modelId: string) => void;
  placeholder?: string;
}

export function OpenRouterModelPicker({ value, onChange, placeholder }: Props) {
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState(value);
  const [openList, setOpenList] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchOpenRouterModels().then(setModels, () => setLoadFailed(true));
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
          setQuery(e.target.value);
          setOpenList(true);
          // Typing a full ID by hand is valid, so persist as the user types.
          onChange(e.target.value.trim());
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
              <div style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>
                {m.id}
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
