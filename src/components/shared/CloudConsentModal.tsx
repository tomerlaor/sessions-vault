import { createPortal } from "react-dom";
import CloudConsentDialog, {
  type CloudConsentDialogProps,
} from "./CloudConsentDialog";

export default function CloudConsentModal(props: CloudConsentDialogProps) {
  return createPortal(<CloudConsentDialog {...props} />, document.body);
}
