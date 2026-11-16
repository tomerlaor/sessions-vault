import type { AIProvider } from "../../types";
import { cloudProviderLabel } from "../../lib/lyrics-privacy";
import CloudConsentModal from "./CloudConsentModal";

interface Props {
  provider: AIProvider;
  localProvider: AIProvider;
  onUseCloud: () => void;
  onSwitchToLocal: () => void;
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
  onUseCloud,
  onSwitchToLocal,
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
      onUseCloud={onUseCloud}
      onSwitchToLocal={onSwitchToLocal}
    />
  );
}
