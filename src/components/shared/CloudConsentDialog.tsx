import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { AIProvider } from "../../types";
import {
  cloudProviderLabel,
  localProviderLabel,
  probeLocalAIServer,
} from "../../lib/lyrics-privacy";
import {
  getFocusableElements,
  handleTabTrap,
  restoreFocus,
} from "../../lib/dialog-focus";

export interface CloudConsentDialogProps {
  title: string;
  intro: ReactNode;
  sentItems: string[];
  provider: AIProvider;
  localProvider: AIProvider;
  // The current AIConfig.baseUrl, if any — switchToLocalAIConfig keeps it
  // instead of overwriting with the default, so the probe must check the
  // same address or it'll pass/fail against a server the switch won't use.
  localBaseUrl?: string;
  onUseCloud: () => void;
  onSwitchToLocal: () => void;
  onDismiss: () => void;
  busy?: boolean;
}

// Unportaled dialog body — split out from CloudConsentModal so markup tests
// can render it with react-dom/server without touching createPortal.
export default function CloudConsentDialog({
  title,
  intro,
  sentItems,
  provider,
  localProvider,
  localBaseUrl,
  onUseCloud,
  onSwitchToLocal,
  onDismiss,
  busy = false,
}: CloudConsentDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    // Focus the panel, not "Use cloud" — an accidental Enter must not
    // confirm cloud consent.
    panelRef.current?.focus();
    return () => restoreFocus(previousFocusRef.current as HTMLElement | null);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Capture phase + stop/preventDefault so neither the Tab Agent's own
      // Esc handler nor the App-level "leave project view" Esc also fires.
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onDismiss]);

  const disabled = busy || probing;

  const handlePanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    handleTabTrap(
      e,
      getFocusableElements(panelRef.current),
      document.activeElement as HTMLElement | null,
    );
  };

  const handleSwitchToLocal = async () => {
    if (disabled) return;
    setProbeError(null);
    setProbing(true);
    try {
      const result = await probeLocalAIServer(localProvider, localBaseUrl);
      if (!result.ok) {
        setProbeError(result.message);
        return;
      }
      onSwitchToLocal();
    } finally {
      setProbing(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
      }}
      // Accidental dismiss of a consent dialog is bad UX — backdrop clicks
      // intentionally do nothing.
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
        style={{
          width: 420,
          maxWidth: "92vw",
          background: "var(--bg-1)",
          border: "1px solid var(--line-2)",
          borderRadius: 10,
          boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 16px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <span id={titleId} style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>
            {title}
          </span>
          <button
            aria-label="Close"
            disabled={disabled}
            onClick={onDismiss}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-3)",
              padding: 4,
              fontSize: 13,
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{ fontSize: 12, color: "var(--text-1)", lineHeight: 1.6 }}
          >
            {intro}
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 12,
              color: "var(--text-2)",
              lineHeight: 1.8,
            }}
          >
            {sentItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div
            style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.6 }}
          >
            Nothing is sent until you choose. You can change this later in
            Settings → AI Assistant.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "0 20px 20px",
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="tb-btn"
              style={{ flex: 1, justifyContent: "center", fontSize: 12 }}
              disabled={disabled}
              onClick={handleSwitchToLocal}
            >
              {probing
                ? "Checking local server…"
                : `Switch to local (${localProviderLabel(localProvider)})`}
            </button>
            <button
              className="tb-btn"
              style={{ flex: 1, justifyContent: "center", fontSize: 12 }}
              disabled={disabled}
              onClick={onUseCloud}
            >
              Use cloud ({cloudProviderLabel(provider)})
            </button>
          </div>
          <div
            style={{ fontSize: 10.5, color: "var(--text-3)", lineHeight: 1.5 }}
          >
            Switching to local applies to all AI features — the lyrics helper
            and the Tab Agent.
          </div>
          {probeError && (
            <div
              style={{
                fontSize: 11,
                color: "var(--red)",
                background: "rgba(255,90,90,0.08)",
                border: "1px solid rgba(255,90,90,0.3)",
                borderRadius: 6,
                padding: "6px 8px",
                lineHeight: 1.5,
              }}
            >
              {probeError}
            </div>
          )}
          <button
            className="tb-btn"
            disabled={disabled}
            onClick={onDismiss}
            style={{
              justifyContent: "center",
              fontSize: 11,
              color: "var(--text-3)",
              background: "transparent",
              border: "none",
              padding: "2px 0",
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
