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
  "Your full lyrics draft",
  "The song context you wrote (what it's about)",
  "The song title, BPM, key and time signature",
  "Style summaries learned from your writing",
  "Your last 5 accepted suggestions",
];

export default function LyricsCloudConsentModal({
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
      title={`Send lyrics to ${cloudProviderLabel(provider)}?`}
      intro={
        <>
          The lyrics helper is set to use <b>{cloudProviderLabel(provider)}</b>,
          a cloud AI provider. Every suggestion request sends:
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
