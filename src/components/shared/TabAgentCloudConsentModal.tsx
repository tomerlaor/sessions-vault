import type { AIProvider } from "../../types";
import { cloudProviderLabel } from "../../lib/lyrics-privacy";
import CloudConsentModal from "./CloudConsentModal";

interface Props {
  provider: AIProvider;
  localProvider: AIProvider;
  localBaseUrl?: string;
  onUseCloud: () => void;
  onSwitchToLocal: () => void;
  onDismiss: () => void;
  busy?: boolean;
}

const SENT_ITEMS = [
  "Section name",
  "Chord progression",
  "Instruments, bar count and time signature",
  "Optional style / feel notes",
  "Your chat messages and the conversation in this window",
  "Section names and chords parsed from this song's lyrics (not the full lyric text)",
];

export default function TabAgentCloudConsentModal({
  provider,
  localProvider,
  localBaseUrl,
  onUseCloud,
  onSwitchToLocal,
  onDismiss,
  busy,
}: Props) {
  return (
    <CloudConsentModal
      title={`Send tab data to ${cloudProviderLabel(provider)}?`}
      intro={
        <>
          The Tab Agent is set to use <b>{cloudProviderLabel(provider)}</b>, a
          cloud AI provider. Every generate or chat request sends:
        </>
      }
      sentItems={SENT_ITEMS}
      provider={provider}
      localProvider={localProvider}
      localBaseUrl={localBaseUrl}
      onUseCloud={onUseCloud}
      onSwitchToLocal={onSwitchToLocal}
      onDismiss={onDismiss}
      busy={busy}
    />
  );
}
