const STORAGE_KEY = "lumen-prefs-v1";
const MAX_RECENTS = 10;

export type RecentDoc = {
  name: string;
  path?: string;
  openedAt: number;
};

export type Prefs = {
  stripBase: number;
  recents: RecentDoc[];
};

const FALLBACK: Prefs = {
  stripBase: 160,
  recents: [],
};

function isRecentDoc(value: unknown): value is RecentDoc {
  if (!value || typeof value !== "object") return false;
  const doc = value as RecentDoc;
  return typeof doc.name === "string" && typeof doc.openedAt === "number";
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

export function rememberRecent(recents: RecentDoc[], name: string, path?: string): RecentDoc[] {
  const next: RecentDoc = { name, path, openedAt: Date.now() };
  return [
    next,
    ...recents.filter((doc) => (path ? doc.path !== path : !doc.path && doc.name !== name)),
  ].slice(0, MAX_RECENTS);
}

export function dropRecent(recents: RecentDoc[], path: string): RecentDoc[] {
  return recents.filter((doc) => doc.path !== path);
}

export function filePathFromFile(file: File): string | undefined {
  const extra = file as File & { path?: string };
  return extra.path || undefined;
}
