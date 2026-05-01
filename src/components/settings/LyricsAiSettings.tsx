import type { LyricsAIConfig, LyricSuggestionMode } from "../../types";

interface Props {
  cfg: LyricsAIConfig;
  onChange: (next: LyricsAIConfig) => void;
  onClearGlobalMemory: () => void;
}

const SUGGESTION_MODES: { id: LyricSuggestionMode; label: string }[] = [
  { id: "completion", label: "Line completion" },
  { id: "next_line", label: "Next line" },
  { id: "alternative", label: "Alternative phrasing" },
];

export default function LyricsAiSettings({
  cfg,
  onChange,
  onClearGlobalMemory,
}: Props) {
  const toggle = (field: keyof LyricsAIConfig, value: unknown) =>
    onChange({ ...cfg, [field]: value });

  const toggleMode = (mode: LyricSuggestionMode) => {
    const next = cfg.enabledModes.includes(mode)
      ? cfg.enabledModes.filter((m) => m !== mode)
      : [...cfg.enabledModes, mode];
    onChange({ ...cfg, enabledModes: next });
  };

  const Row = ({ children }: { children: React.ReactNode }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );

  const Label = ({ children }: { children: React.ReactNode }) => (
    <span style={{ fontSize: 12, color: "var(--text-1)" }}>{children}</span>
  );

  const ToggleBtn = ({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      style={{
        padding: "3px 10px",
        fontSize: 11,
        borderRadius: 4,
        border: "1px solid var(--line-2)",
        background: active ? "var(--accent)" : "var(--bg-2)",
        color: active ? "#1a0a00" : "var(--text-2)",
        fontWeight: active ? 700 : 400,
      }}
    >
      {children}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Master toggle */}
      <Row>
        <Label>AI suggestions</Label>
        <ToggleBtn
          active={cfg.enabled}
          onClick={() => toggle("enabled", !cfg.enabled)}
        >
          {cfg.enabled ? "On" : "Off"}
        </ToggleBtn>
      </Row>

      {cfg.enabled && (
        <>
          {/* Suggestion mode */}
          <Row>
            <Label>Appearance</Label>
            <div style={{ display: "flex", gap: 4 }}>
              <ToggleBtn
                active={cfg.mode === "inline"}
                onClick={() => toggle("mode", "inline")}
              >
                Inline
              </ToggleBtn>
              <ToggleBtn
                active={cfg.mode === "popup"}
                onClick={() => toggle("mode", "popup")}
              >
                Popup
              </ToggleBtn>
            </div>
          </Row>

          {/* Enabled suggestion types */}
          <div style={{ marginBottom: 10 }}>
            <div
              style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}
            >
              Suggestion types
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {SUGGESTION_MODES.map(({ id, label }) => (
                <label
                  key={id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={cfg.enabledModes.includes(id)}
                    onChange={() => toggleMode(id)}
                    style={{
                      accentColor: "var(--accent)",
                      width: 13,
                      height: 13,
                    }}
                  />
                  <span style={{ fontSize: 12, color: "var(--text-1)" }}>
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Feedback mode */}
          <Row>
            <Label>Feedback style</Label>
            <div style={{ display: "flex", gap: 4 }}>
              <ToggleBtn
                active={cfg.feedbackMode === "minimal"}
                onClick={() => toggle("feedbackMode", "minimal")}
              >
                Minimal
              </ToggleBtn>
              <ToggleBtn
                active={cfg.feedbackMode === "tagged"}
                onClick={() => toggle("feedbackMode", "tagged")}
              >
                Tagged
              </ToggleBtn>
            </div>
          </Row>

          {/* Memory reset */}
          <div
            style={{
              marginTop: 4,
              paddingTop: 10,
              borderTop: "1px solid var(--line)",
            }}
          >
            <div
              style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}
            >
              Style memory helps the AI match your writing style over time.
            </div>
            <button
              onClick={onClearGlobalMemory}
              className="tb-btn"
              style={{ fontSize: 11 }}
            >
              Clear all style memory
            </button>
          </div>
        </>
      )}
    </div>
  );
}
