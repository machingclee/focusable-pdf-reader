/**
 * The confirmation for something that was just saved.
 *
 * The menu that started the write is closed by the time the popup confirms, so
 * the message has nowhere else to live. It clears itself after a few seconds; the
 * message is the panels slice's, so whatever saved something only has to say so.
 */
import { useAppSelector } from "../../store/hooks";
import { selectToast } from "../../store/slices/panelsSlice";

export function SaveToast() {
  const message = useAppSelector(selectToast);
  if (!message) return null;
  return (
    <div className="save-toast" role="status">
      {message}
    </div>
  );
}
