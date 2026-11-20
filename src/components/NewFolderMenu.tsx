/**
 * The menu that opens on a right-click on the notes column's empty space, where
 * every other hit already has its own menu: cards have the strip menu, headers
 * have the folder menu, and this is where a folder gets made.
 *
 * It replaced a permanent "New folder [field] Add" row above the list: the field
 * was on screen for the one time in ten you wanted it, and it pushed the actual
 * notes down in a column that is short of height to begin with.
 */
import { useState, type FormEvent } from "react";
import { ContextMenu } from "./ContextMenu";

export type NewFolderMenuProps = {
  /** Viewport coordinates of the pointer. */
  x: number;
  y: number;
  onCreate: (name: string) => void;
  onClose: () => void;
};

export function NewFolderMenu({ x, y, onCreate, onClose }: NewFolderMenuProps) {
  const [name, setName] = useState("");
  const trimmed = name.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed.length === 0) return;
    onCreate(trimmed);
  };

  return (
    <ContextMenu x={x} y={y} label="New folder" onClose={onClose}>
      <form className="strip-menu-form" onSubmit={submit}>
        <input
          className="strip-menu-field"
          value={name}
          autoFocus
          placeholder="Folder name"
          aria-label="New folder name"
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="strip-menu-submit" disabled={trimmed.length === 0}>
          Create
        </button>
      </form>
    </ContextMenu>
  );
}
