import { createPortal } from "react-dom";
import type { AIProvider } from "../../types";
import {
  cloudProviderLabel,
  localProviderLabel,
} from "../../lib/lyrics-privacy";

interface Props {
  provider: AIProvider;
  localProvider: AIProvider;
  onUseCloud: () => void;
  onSwitchToLocal: () => void;
}

const SENT_ITEMS = [
  "Your full lyrics draft",
  "The song context you wrote (what it's about)",
  "The song title, BPM, key and time signature",
  "Style summaries learned from your writing",
  "Your last 5 accepted suggestions",
];

export default function LyricsCloudConsentModal({
  provider,
  localProvider,
  onUseCloud,
  onSwitchToLocal,
}: Props) {
  return createPortal(
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
    >
      <div
        style={{
          width: 420,
          maxWidth: "92vw",
          background: "var(--bg-1)",
          border: "1px solid var(--line-2)",
          borderRadius: 10,
          boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--line)",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Send lyrics to {cloudProviderLabel(provider)}?
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
            The lyrics helper is set to use{" "}
            <b>{cloudProviderLabel(provider)}</b>, a cloud AI provider. Every
            suggestion request sends:
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
            {SENT_ITEMS.map((item) => (
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
            gap: 8,
            padding: "0 20px 20px",
          }}
        >
          <button
            className="tb-btn"
            style={{ flex: 1, justifyContent: "center", fontSize: 12 }}
            onClick={onSwitchToLocal}
          >
            Switch to local ({localProviderLabel(localProvider)})
          </button>
          <button
            className="tb-btn"
            style={{ flex: 1, justifyContent: "center", fontSize: 12 }}
            onClick={onUseCloud}
          >
            Use cloud ({cloudProviderLabel(provider)})
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
