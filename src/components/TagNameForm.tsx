import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

/**
 * An inline "name + Add" form.
 *
 * The tag popovers create their folders and tags with forms that sit in the
 * pane they affect, not in a modal: the popover is already the focused surface,
 * and this app avoids permanent input rows in narrow columns.
 *
 * The form replaces the "+ New folder" / "+ New tag" button where the button
 * already was, so opening it does not move the reader's eye: the pane's add row
 * stays on its last line and the field takes that line's place (that row is a
 * footer of the pane — `.tag-add-row` in `App.css`, outside the scrolling list —
 * so the field cannot float over the list or scroll away with it).
 *
 * `onCreate` answers whether the write landed; only then does the form clear and
 * close, so a rejected name stays in the field for the reader to fix.
 *
 * Escape cancels the add — the field and its draft go away, focus goes back to
 * the button, and the popover stays open. The press belongs to the form, not to
 * the panel, so it is stopped here: the shell's own Escape would otherwise close
 * the whole popover on the same key.
 */
export function TagNameForm({
  placeholder,
  submitLabel,
  onCreate,
  buttonClassName = "ghost tag-add-button",
}: {
  placeholder: string;
  submitLabel: string;
  onCreate: (name: string) => Promise<boolean>;
  /** How the closed form's trigger looks: a row-level "add" or a pane toolbar button. */
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  /** Set by the closes that hand focus back: a cancel, or a create that landed. */
  const refocus = useRef(false);

  // The trigger is remounted as the form goes away, so the focus goes back in an
  // effect rather than in the handler. Escape then means "cancel this row" once
  // and "close the panel" on the next press, the way the other layers work.
  useEffect(() => {
    if (open || !refocus.current) return;
    refocus.current = false;
    triggerRef.current?.focus();
  }, [open]);

  async function submit() {
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const created = await onCreate(trimmed);
      if (created) {
        setName("");
        refocus.current = true;
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }

  /** Put the form away and drop the draft: what Escape and a rebuilt pane both mean. */
  function cancel() {
    if (busy) return;
    refocus.current = true;
    setName("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button ref={triggerRef} type="button" className={buttonClassName} onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden />
        {submitLabel}
      </button>
    );
  }

  return (
    <form
      className="tag-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      // Escape is this form's while it is open: it cancels the add and stops
      // there, so one press does not also take away the popover behind it.
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }}
    >
      <input
        className="tag-field"
        value={name}
        autoFocus
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
      />
      <button type="submit" className="tag-small-button" disabled={trimmed.length === 0 || busy}>
        Add
      </button>
    </form>
  );
}
