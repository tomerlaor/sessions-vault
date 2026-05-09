import { useState, useEffect, useRef } from "react";
import { getAIConfig } from "../../db/queries/ai";
import { generateTabStructure, chatWithTabAgent } from "../../lib/ai";
import { parseLyricsStructure } from "../../lib/lyrics-structure";
import type { Project, TabPart, Instrument, AIConfig } from "../../types";

interface Props {
  project: Project;
  onInsert: (parts: TabPart[]) => void;
  onClose: () => void;
}

type Step =
  | "loading"
  | "no-config"
  | "confirm"
  | "section"
  | "instruments"
  | "chords"
  | "bars"
  | "timesig"
  | "style"
  | "preview"
  | "generating"
  | "error";

interface WizardState {
  sectionName: string;
  instruments: Instrument[];
  chords: string;
  bars: number;
  timeSignature: string;
  styleNote: string;
}

interface AgentMessage {
  role: "agent" | "user";
  text: string;
}

const INSTRUMENTS: Instrument[] = ["guitar", "bass", "drums"];

function Bubble({ msg }: { msg: AgentMessage }) {
  return (
    <div className={`agent-bubble ${msg.role}`}>
      {msg.role === "agent" && <span className="agent-avatar">✦</span>}
      <div className="agent-bubble-text">{msg.text}</div>
    </div>
  );
}

export default function TabAgentModal({ project, onInsert, onClose }: Props) {
  const [step, setStep] = useState<Step>("loading");
  const [aiCfg, setAiCfg] = useState<AIConfig | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [wizard, setWizard] = useState<WizardState>({
    sectionName: "",
    instruments: ["guitar", "bass", "drums"],
    chords: "",
    bars: 8,
    timeSignature: project.timeSignature ?? "4/4",
    styleNote: "",
  });
  const [preview, setPreview] = useState<TabPart[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [lyricsHint, setLyricsHint] = useState<
    { name: string; chords: string }[]
  >([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const addAgent = (text: string) =>
    setMessages((m) => [...m, { role: "agent", text }]);
  const addUser = (text: string) =>
    setMessages((m) => [...m, { role: "user", text }]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, chatSending]);

  useEffect(() => {
    getAIConfig().then((cfg) => {
      if (
        !cfg?.apiKey &&
        (cfg?.provider === "openai" || cfg?.provider === "anthropic")
      ) {
        setStep("no-config");
        return;
      }
      if (!cfg) {
        setStep("no-config");
        return;
      }
      setAiCfg(cfg);

      const sections = parseLyricsStructure(project.lyrics);
      setLyricsHint(sections);

      if (sections.length > 0) {
        addAgent(
          `Here is the song structure I identified:\n` +
            sections
              .map((s) => `• ${s.name}${s.chords ? ` — ${s.chords}` : ""}`)
              .join("\n") +
            `\n\nShall I proceed with creating the tab structure?`,
        );
        setStep("confirm");
      } else {
        addAgent(
          "Let's build a tab structure. What's the name of this section? (e.g. Verse, Chorus, Bridge)",
        );
        setStep("section");
      }
    });
  }, [project.lyrics]);

  const goToInstruments = (sectionName: string, chords: string) => {
    const next = { ...wizard, sectionName, chords };
    setWizard(next);
    addUser(sectionName);
    addAgent(
      `Which instruments should I generate for this section? Toggle on or off below.`,
    );
    setStep("instruments");
  };

  const goToChords = () => {
    addUser(wizard.instruments.join(", "));
    if (wizard.chords) {
      addAgent(
        `I'll use the chords from your lyrics: ${wizard.chords}\n\nFeel free to edit them below, or confirm to continue.`,
      );
    } else {
      addAgent(`What's the chord progression? (e.g. Am – F – C – G)`);
    }
    setStep("chords");
  };

  const goToBars = (chords: string) => {
    setWizard((w) => ({ ...w, chords }));
    addUser(chords || "(none)");
    addAgent(`How many bars should this section be?`);
    setStep("bars");
  };

  const goToTimeSig = (bars: number) => {
    setWizard((w) => ({ ...w, bars }));
    addUser(`${bars} bars`);
    if (project.timeSignature) {
      addAgent(
        `Your project is set to ${project.timeSignature}. Confirm or change the time signature below.`,
      );
    } else {
      addAgent(`What's the time signature?`);
    }
    setStep("timesig");
  };

  const goToStyle = (timeSig: string) => {
    setWizard((w) => ({ ...w, timeSignature: timeSig }));
    addUser(timeSig);
    addAgent(
      `Any playing feel or style notes? (optional — e.g. "palm muted", "arpeggiated", "funk groove")\nLeave blank to skip.`,
    );
    setStep("style");
  };

  const goToPreview = (styleNote: string) => {
    const finalWizard = { ...wizard, styleNote };
    setWizard(finalWizard);
    addUser(styleNote || "(none)");

    const instList = finalWizard.instruments
      .map(
        (i) =>
          `${finalWizard.sectionName} ${i.charAt(0).toUpperCase() + i.slice(1)}`,
      )
      .join(", ");
    addAgent(
      `Ready to generate!\n\n` +
        `Section: ${finalWizard.sectionName}\n` +
        `Parts: ${instList}\n` +
        `Chords: ${finalWizard.chords || "(none)"}\n` +
        `Bars: ${finalWizard.bars} × ${finalWizard.timeSignature}` +
        (finalWizard.styleNote ? `\nStyle: ${finalWizard.styleNote}` : ""),
    );
    setStep("preview");
  };

  const handleGenerate = async () => {
    if (!aiCfg) return;
    setStep("generating");
    addAgent("Generating your tab structure…");
    try {
      const result = await generateTabStructure(aiCfg, {
        sectionName: wizard.sectionName,
        instruments: wizard.instruments,
        chords: wizard.chords,
        bars: wizard.bars,
        timeSignature: wizard.timeSignature,
        styleNote: wizard.styleNote,
      });

      const parts: TabPart[] = result.parts.map((p) => ({
        id: crypto.randomUUID(),
        name: p.name,
        instrument: p.instrument,
        content: p.content,
      }));

      setPreview(parts);
      addAgent(`Done! Here's a preview of the generated structure.`);
      setStep("preview");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  };

  const handleInsert = () => {
    onInsert(preview);
    onClose();
  };

  const sendFreeformMessage = async () => {
    const text = chatInput.trim();
    if (!text || !aiCfg || chatSending) return;
    setChatInput("");
    addUser(text);
    setChatSending(true);
    try {
      const sectionCtx =
        lyricsHint.length > 0
          ? `\nSections in this project's lyrics:\n${lyricsHint.map((s) => `• ${s.name}${s.chords ? ` — ${s.chords}` : ""}`).join("\n")}`
          : "";
      const system = `You are a music tab structure assistant. Help the user generate or refine guitar/bass/drums tab structures. Be concise and practical.${sectionCtx}`;
      const history: { role: "user" | "assistant"; content: string }[] =
        messages.map((m) => ({
          role: m.role === "agent" ? "assistant" : "user",
          content: m.text,
        }));
      history.push({ role: "user", content: text });
      const reply = await chatWithTabAgent(aiCfg, system, history);
      addAgent(reply);
    } catch (e) {
      addAgent(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setChatSending(false);
    }
  };

  return (
    <div
      className="agent-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="agent-modal">
        {/* Header */}
        <div className="agent-header">
          <span className="agent-title">✦ Tab Structure Generator</span>
          <button
            onClick={onClose}
            style={{ color: "var(--text-3)", padding: "2px 6px" }}
          >
            ✕
          </button>
        </div>

        {/* Chat history */}
        <div className="agent-chat" ref={chatRef}>
          {step === "loading" && (
            <div className="agent-thinking">Analysing your project…</div>
          )}

          {step === "no-config" && (
            <div className="agent-bubble agent">
              <span className="agent-avatar">✦</span>
              <div className="agent-bubble-text">
                No AI provider configured yet. Open{" "}
                <b>Settings → AI Assistant</b> to add your API key or local
                runner URL, then come back.
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <Bubble key={i} msg={msg} />
          ))}

          {(step === "generating" || chatSending) && (
            <div className="agent-thinking">
              {chatSending ? "Thinking…" : "Calling AI…"}
            </div>
          )}
        </div>

        {/* Step controls — guided shortcuts, changes per step */}
        <div className="agent-input-area">
          {step === "confirm" && (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="tb-btn primary"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => {
                  addUser("Yes, proceed");
                  addAgent(
                    "Which section would you like to start with?",
                  );
                  setStep("section");
                }}
              >
                Proceed →
              </button>
              <button
                className="tb-btn"
                onClick={() => {
                  addUser("Let me pick a different section");
                  addAgent(
                    "No problem — which section would you like to create tabs for?",
                  );
                  setStep("section");
                }}
              >
                Customize
              </button>
            </div>
          )}

          {step === "section" && (
            <SectionStep
              hints={lyricsHint}
              onConfirm={(name, chords) => goToInstruments(name, chords)}
            />
          )}

          {step === "instruments" && (
            <InstrumentsStep
              selected={wizard.instruments}
              onChange={(insts) =>
                setWizard((w) => ({ ...w, instruments: insts }))
              }
              onConfirm={goToChords}
            />
          )}

          {step === "chords" && (
            <ChordsStep initial={wizard.chords} onConfirm={goToBars} />
          )}

          {step === "bars" && (
            <BarsStep initial={wizard.bars} onConfirm={goToTimeSig} />
          )}

          {step === "timesig" && (
            <TimeSigStep initial={wizard.timeSignature} onConfirm={goToStyle} />
          )}

          {step === "style" && <StyleStep onConfirm={goToPreview} />}

          {step === "preview" && preview.length === 0 && (
            <button
              className="tb-btn primary"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={handleGenerate}
            >
              ✦ Generate structure
            </button>
          )}

          {step === "preview" && preview.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {preview.map((pt, i) => (
                <div key={i} className="agent-preview-part">
                  <div className="agent-preview-label">{pt.name}</div>
                  <pre className="agent-preview-content">{pt.content}</pre>
                </div>
              ))}
              <button
                className="tb-btn primary"
                style={{
                  width: "100%",
                  justifyContent: "center",
                  marginTop: 4,
                }}
                onClick={handleInsert}
              >
                Insert into Tab
              </button>
            </div>
          )}

          {step === "error" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--red)",
                  background: "rgba(255,90,90,0.08)",
                  border: "1px solid rgba(255,90,90,0.3)",
                  borderRadius: 6,
                  padding: "8px 10px",
                }}
              >
                {errorMsg}
              </div>
              <button className="tb-btn" onClick={() => setStep("preview")}>
                ← Try again
              </button>
            </div>
          )}
        </div>

        {/* Compose bar — always visible */}
        <div className="agent-compose">
          <input
            className="agent-text-input"
            placeholder="Ask anything… (e.g. 'add a bridge section with funk feel')"
            value={chatInput}
            disabled={
              chatSending ||
              step === "loading" ||
              step === "no-config" ||
              step === "generating"
            }
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendFreeformMessage();
              }
            }}
          />
          <button
            className="agent-send-btn"
            disabled={
              !chatInput.trim() ||
              chatSending ||
              step === "loading" ||
              step === "no-config" ||
              step === "generating"
            }
            onClick={sendFreeformMessage}
          >
            {chatSending ? "…" : "↑"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Step sub-components ── */

function SectionStep({
  hints,
  onConfirm,
}: {
  hints: { name: string; chords: string }[];
  onConfirm: (name: string, chords: string) => void;
}) {
  const [custom, setCustom] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {hints.map((h) => (
        <button
          key={h.name}
          className="agent-choice-btn"
          onClick={() => onConfirm(h.name, h.chords)}
        >
          <span style={{ fontWeight: 600 }}>{h.name}</span>
          {h.chords && (
            <span style={{ color: "var(--text-3)", fontSize: 11 }}>
              {h.chords}
            </span>
          )}
        </button>
      ))}
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="agent-text-input"
          placeholder="Custom section name…"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && custom.trim())
              onConfirm(custom.trim(), "");
          }}
        />
        <button
          className="tb-btn primary"
          disabled={!custom.trim()}
          onClick={() => onConfirm(custom.trim(), "")}
        >
          →
        </button>
      </div>
    </div>
  );
}

function InstrumentsStep({
  selected,
  onChange,
  onConfirm,
}: {
  selected: Instrument[];
  onChange: (i: Instrument[]) => void;
  onConfirm: () => void;
}) {
  const toggle = (inst: Instrument) =>
    onChange(
      selected.includes(inst)
        ? selected.filter((i) => i !== inst)
        : [...selected, inst],
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {INSTRUMENTS.map((inst) => (
          <button
            key={inst}
            className="tb-btn"
            style={
              selected.includes(inst)
                ? {
                    background: "var(--accent)",
                    borderColor: "var(--accent)",
                    color: "#1a0a00",
                    fontWeight: 600,
                  }
                : {}
            }
            onClick={() => toggle(inst)}
          >
            {inst.charAt(0).toUpperCase() + inst.slice(1)}
          </button>
        ))}
      </div>
      <button
        className="tb-btn primary"
        disabled={selected.length === 0}
        style={{ alignSelf: "flex-start" }}
        onClick={onConfirm}
      >
        Confirm →
      </button>
    </div>
  );
}

function ChordsStep({
  initial,
  onConfirm,
}: {
  initial: string;
  onConfirm: (c: string) => void;
}) {
  const [val, setVal] = useState(initial);
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <input
        className="agent-text-input"
        placeholder="e.g. Am – F – C – G"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm(val.trim());
        }}
      />
      <button className="tb-btn primary" onClick={() => onConfirm(val.trim())}>
        →
      </button>
    </div>
  );
}

function BarsStep({
  initial,
  onConfirm,
}: {
  initial: number;
  onConfirm: (n: number) => void;
}) {
  const [val, setVal] = useState(initial);
  const OPTIONS = [4, 8, 12, 16];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {OPTIONS.map((n) => (
          <button
            key={n}
            className="tb-btn"
            style={
              val === n
                ? {
                    background: "var(--accent)",
                    borderColor: "var(--accent)",
                    color: "#1a0a00",
                    fontWeight: 600,
                  }
                : {}
            }
            onClick={() => setVal(n)}
          >
            {n}
          </button>
        ))}
        <input
          type="number"
          min={1}
          max={64}
          value={val}
          onChange={(e) => setVal(Number(e.target.value))}
          style={{
            width: 56,
            background: "var(--bg-2)",
            border: "1px solid var(--line)",
            borderRadius: 4,
            padding: "4px 8px",
            fontSize: 12,
            color: "var(--text-0)",
            textAlign: "center",
          }}
        />
      </div>
      <button
        className="tb-btn primary"
        style={{ alignSelf: "flex-start" }}
        onClick={() => onConfirm(val)}
      >
        Confirm →
      </button>
    </div>
  );
}

function TimeSigStep({
  initial,
  onConfirm,
}: {
  initial: string;
  onConfirm: (s: string) => void;
}) {
  const [val, setVal] = useState(initial);
  const OPTIONS = ["4/4", "3/4", "6/8", "12/8", "5/4", "7/8"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {OPTIONS.map((s) => (
          <button
            key={s}
            className="tb-btn"
            style={
              val === s
                ? {
                    background: "var(--accent)",
                    borderColor: "var(--accent)",
                    color: "#1a0a00",
                    fontWeight: 600,
                  }
                : {}
            }
            onClick={() => setVal(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <button
        className="tb-btn primary"
        style={{ alignSelf: "flex-start" }}
        onClick={() => onConfirm(val)}
      >
        Confirm →
      </button>
    </div>
  );
}

function StyleStep({ onConfirm }: { onConfirm: (s: string) => void }) {
  const [val, setVal] = useState("");
  const SUGGESTIONS = [
    "palm muted",
    "arpeggiated",
    "strummed",
    "funk groove",
    "fingerpicked",
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            className="tb-btn"
            style={
              val === s
                ? { background: "var(--bg-3)", color: "var(--text-0)" }
                : {}
            }
            onClick={() => setVal((v) => (v === s ? "" : s))}
          >
            {s}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="agent-text-input"
          placeholder="Custom style note… (optional)"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onConfirm(val.trim());
          }}
        />
        <button
          className="tb-btn primary"
          onClick={() => onConfirm(val.trim())}
        >
          →
        </button>
      </div>
    </div>
  );
}
