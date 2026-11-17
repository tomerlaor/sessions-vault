import type { AIProvider } from "../../types";
import { cloudProviderLabel } from "../../lib/lyrics-privacy";

interface ConsentRowProps {
  feature: string;
  provider?: AIProvider;
  grantedAt?: number;
  onRevoke: () => void;
}

function ConsentRow({
  feature,
  provider,
  grantedAt,
  onRevoke,
}: ConsentRowProps) {
  const granted = !!grantedAt && !!provider;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
      }}
    >
      <span style={{ flex: 1, color: "var(--text-2)" }}>
        {feature}:{" "}
        {granted ? (
          <span style={{ color: "var(--green)" }}>
            Granted for {cloudProviderLabel(provider!)}
          </span>
        ) : (
          <span style={{ color: "var(--text-3)" }}>Not granted</span>
        )}
      </span>
      {granted && (
        <button
          className="tb-btn"
          style={{ fontSize: 10, padding: "2px 8px" }}
          onClick={onRevoke}
        >
          Revoke
        </button>
      )}
    </div>
  );
}

interface Props {
  lyricsProvider?: AIProvider;
  lyricsGrantedAt?: number;
  tabAgentProvider?: AIProvider;
  tabAgentGrantedAt?: number;
  onRevokeLyrics: () => void;
  onRevokeTabAgent: () => void;
}

// Settings → AI Assistant "Cloud consent" block: shows the per-feature
// consent state (lyrics helper, Tab Agent) and lets the user revoke it
// without touching the configured provider or key.
export default function CloudConsentSection({
  lyricsProvider,
  lyricsGrantedAt,
  tabAgentProvider,
  tabAgentGrantedAt,
  onRevokeLyrics,
  onRevokeTabAgent,
}: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-3)",
        }}
      >
        Cloud consent
      </div>
      <ConsentRow
        feature="Lyrics helper"
        provider={lyricsProvider}
        grantedAt={lyricsGrantedAt}
        onRevoke={onRevokeLyrics}
      />
      <ConsentRow
        feature="Tab Agent"
        provider={tabAgentProvider}
        grantedAt={tabAgentGrantedAt}
        onRevoke={onRevokeTabAgent}
      />
    </div>
  );
}
