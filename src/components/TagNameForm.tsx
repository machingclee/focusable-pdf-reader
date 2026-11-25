import { useState } from "react";
import { Plus } from "lucide-react";

/**
 * An inline "name + Add" form.
 *
 * The tag popovers create their folders and tags with forms that sit in the
 * pane they affect, not in a modal: the popover is already the focused surface,
 * and this app avoids permanent input rows in narrow columns.
 *
 * `onCreate` answers whether the write landed; only then does the form clear and
 * close, so a rejected name stays in the field for the reader to fix.
 */
export function TagNameForm({
  placeholder,
  submitLabel,
  onCreate,
}: {
  placeholder: string;
  submitLabel: string;
  onCreate: (name: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();

  async function submit() {
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const created = await onCreate(trimmed);
      if (created) {
        setName("");
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="ghost tag-add-button" onClick={() => setOpen(true)}>
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
    >
      <input
        className="tag-field"
        value={name}
        autoFocus
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      />
      <button type="submit" className="tag-small-button" disabled={trimmed.length === 0 || busy}>
        Add
      </button>
    </form>
  );
}
