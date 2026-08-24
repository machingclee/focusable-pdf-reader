const STORAGE_KEY = "lumen-prefs-v1";
const MAX_RECENTS = 10;

export type RecentDoc = {
  name: string;
  path?: string;
  openedAt: number;
  page?: number;
};

export type Prefs = {
  /** Focus strip height in PDF points (1pt = 1 CSS px at 100% zoom). Independent of zoom. */
  stripBase: number;
  recents: RecentDoc[];
};

const FALLBACK: Prefs = {
  stripBase: 160,
  recents: [],
};

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isRecentDoc(value: unknown): value is RecentDoc {
  if (!value || typeof value !== "object") return false;
  const doc = value as RecentDoc;
  if (typeof doc.name !== "string" || typeof doc.openedAt !== "number") return false;
  if (doc.page !== undefined && !isPositiveInt(doc.page)) return false;
  return true;
}

function matchesRecent(doc: RecentDoc, name: string, path?: string): boolean {
  return path ? doc.path === path : !doc.path && doc.name === name;
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return FALLBACK;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const stripBase = Number(parsed.stripBase);
    const recents = Array.isArray(parsed.recents) ? parsed.recents.filter(isRecentDoc) : [];
    return {
      stripBase: Number.isFinite(stripBase) ? stripBase : FALLBACK.stripBase,
      recents: recents.slice(0, MAX_RECENTS),
    };
  } catch {
    return FALLBACK;
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      stripBase: prefs.stripBase,
      recents: prefs.recents.slice(0, MAX_RECENTS),
    }));
  } catch {
    // quota / private mode
  }
}

export function rememberRecent(
  recents: RecentDoc[],
  name: string,
  path?: string,
  page?: number,
): RecentDoc[] {
  const existing = recents.find((doc) => matchesRecent(doc, name, path));
  const next: RecentDoc = {
    name,
    path,
    openedAt: Date.now(),
    page: page ?? existing?.page,
  };
  return [next, ...recents.filter((doc) => !matchesRecent(doc, name, path))].slice(0, MAX_RECENTS);
}

export function rememberPage(recents: RecentDoc[], name: string, path: string | undefined, page: number): RecentDoc[] {
  let changed = false;
  const next = recents.map((doc) => {
    if (!matchesRecent(doc, name, path) || doc.page === page) return doc;
    changed = true;
    return { ...doc, page };
  });
  return changed ? next : recents;
}

export function dropRecent(recents: RecentDoc[], path: string): RecentDoc[] {
  return recents.filter((doc) => doc.path !== path);
}

export function filePathFromFile(file: File): string | undefined {
  const extra = file as File & { path?: string };
  return extra.path || undefined;
}
