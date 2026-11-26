import { Service } from "@machingclee/express-cqrs";
import type { Command } from "@machingclee/express-cqrs";
import type { Note, NoteFolder } from "../../pdf-note-management/types.ts";
import { discardTrashedCopies } from "../../../common/library.ts";

/** How many undo steps a session keeps. The oldest step falls off and becomes permanent. */
export const HISTORY_LIMIT = 100;

export type HistoryDirection = "undo" | "redo";

/** One committed library change, and the command that puts it back. */
export type HistoryStep = {
  label: string;
  undo: Command<any>;
  redo: Command<any>;
  /** Library paths whose trash copies can be deleted once this step is discarded. */
  trashFiles: string[];
};

export type HistoryStatus = {
  label: string;
  canUndo: boolean;
  canRedo: boolean;
};

/**
 * A strip save that may also open the default folder, gathered across the
 * nested commands of that one request and pushed as a single step.
 *
 * This is the one note-shaped draft: the note context opens it while saving a
 * strip, and `HistoryPolicy` closes it into a step.
 */
export type StripCreateDraft = {
  requestId: string;
  strip: Note;
  createdFolder: NoteFolder | null;
  assigned: Note | null;
};

/**
 * The session's undo and redo stacks.
 *
 * One instance for the process: both windows share the library, so they share
 * the stack. It dies when the process quits. Nothing here is written to the
 * database.
 *
 * The note and tag contexts write here through `recordHistory`; the stack
 * itself belongs to the history context, which is why this file lives here and
 * not beside the notes it remembers.
 */
@Service()
export class SessionHistory {
  private undoStack: HistoryStep[] = [];
  private redoStack: HistoryStep[] = [];
  private applying = 0;
  private stripDraft: StripCreateDraft | null = null;
  private tail: Promise<void> = Promise.resolve();

  /** True while an undo or redo command is being applied, so it does not record itself. */
  isApplying(): boolean {
    return this.applying > 0;
  }

  beginApply(): void {
    this.applying += 1;
    this.stripDraft = null;
  }

  endApply(): void {
    this.applying = Math.max(0, this.applying - 1);
  }

  /** The step Cmd+Z or Cmd+Y would apply, without removing it. */
  peek(direction: HistoryDirection): HistoryStep | undefined {
    const stack = direction === "undo" ? this.undoStack : this.redoStack;
    return stack[stack.length - 1];
  }

  /**
   * What the stacks will hold once `direction` has moved its step across.
   * Computed before the post-commit listener actually moves it.
   */
  statusAfter(direction: HistoryDirection): HistoryStatus {
    const step = this.peek(direction);
    if (!step) {
      return { label: "", canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 };
    }
    if (direction === "undo") {
      return { label: step.label, canUndo: this.undoStack.length > 1, canRedo: true };
    }
    return { label: step.label, canUndo: true, canRedo: this.redoStack.length > 1 };
  }

  /** Remember a committed change. A new change drops the redo stack. */
  async push(step: HistoryStep): Promise<void> {
    const discarded = this.redoStack.splice(0);
    this.undoStack.push(step);
    const evicted: HistoryStep[] = [];
    while (this.undoStack.length > HISTORY_LIMIT) {
      const oldest = this.undoStack.shift();
      if (oldest) evicted.push(oldest);
    }
    await discardTrashedCopies([...discarded, ...evicted].flatMap((item) => item.trashFiles));
  }

  /** The post-commit half of undo/redo: the step changes stacks. */
  commitApply(direction: HistoryDirection): void {
    const from = direction === "undo" ? this.undoStack : this.redoStack;
    const to = direction === "undo" ? this.redoStack : this.undoStack;
    const step = from.pop();
    if (step) to.push(step);
  }

  /**
   * Run `fn` only after the previous undo or redo has finished, including the
   * listener that moves the step. Two windows share this stack.
   */
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Start gathering the folder a brand-new strip's save may open. */
  openStripDraft(strip: Note, requestId: string): void {
    this.stripDraft = { requestId, strip, createdFolder: null, assigned: null };
  }

  /**
   * The folder opened for the strip currently being saved.
   * False when this create is the reader's own "new folder", which is its own step,
   * and false when the draft belongs to a request that already rolled back.
   */
  noteCreatedFolder(folder: NoteFolder, requestId: string): boolean {
    if (!this.stripDraft || this.stripDraft.requestId !== requestId) return false;
    this.stripDraft.createdFolder = folder;
    return true;
  }

  /** The strip after it was filed into the folder this save opened. */
  noteAssigned(strip: Note, requestId: string): boolean {
    if (!this.stripDraft || this.stripDraft.requestId !== requestId) return false;
    if (this.stripDraft.strip.id !== strip.id) return false;
    this.stripDraft.assigned = strip;
    return true;
  }

  /** Take the gathered strip save, if this request was one. */
  closeStripDraft(): StripCreateDraft | null {
    const draft = this.stripDraft;
    this.stripDraft = null;
    return draft;
  }

  /** Drop a draft whose command rolled back, so the next change cannot adopt it. */
  abandonStripDraft(): void {
    this.stripDraft = null;
  }

  /** Test aid: the process-wide stacks start empty for each case. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.applying = 0;
    this.stripDraft = null;
  }
}
