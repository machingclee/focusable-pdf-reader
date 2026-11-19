/**
 * Where the backend lives.
 *
 * Two modes, decided by Vite's `import.meta.env.DEV`:
 *
 * - **Development** (`npm run dev` -> `vite dev`): the backend is started
 *   separately with `npm run dev:backend` (`bun --watch`), on the fixed port
 *   from `VITE_BACKEND_PORT` (4317, see `.env.development`).
 * - **Production** (packaged app): Rust spawns the sidecar with `PORT=0`, so the
 *   port is only known at runtime. The frontend asks for it with the
 *   `get_backend_info` command, or waits for the `backend-ready` event.
 *
 * `VITE_BACKEND_URL` overrides both, which is useful for loading a build in a
 * plain browser against a backend you started yourself.
 */

/** Matches `PORT` in `backend/package.json`'s `dev` script. */
export const DEFAULT_DEV_BACKEND_PORT = 4317;

/** Matches the timeout of the Rust `get_backend_info` command. */
const STARTUP_TIMEOUT_MS = 20_000;

/** Tauri event Rust emits once the sidecar reported its port. */
const READY_EVENT = "backend-ready";

export type BackendTarget = {
  /** e.g. `http://127.0.0.1:4317`, never with a trailing slash. */
  baseUrl: string;
  /** Shared secret sent as `X-Backend-Token`; `null` when the backend has none. */
  token: string | null;
};

/** Payload of `get_backend_info` and `backend-ready` in Tauri builds. */
export type BackendInfoPayload = {
  port: number;
  token?: string | null;
};

export type BackendEnv = {
  /** Vite's `import.meta.env.DEV`. */
  DEV: boolean;
  VITE_BACKEND_URL?: string;
  VITE_BACKEND_PORT?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePort(raw: string | undefined, name: string): number | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a number, got ${JSON.stringify(value)}`);
  const port = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be between 1 and 65535, got ${port}`);
  }
  return port;
}

function parseBaseUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(url)) {
    throw new Error(`VITE_BACKEND_URL must look like http://127.0.0.1:4317, got ${JSON.stringify(raw)}`);
  }
  return url;
}

/**
 * The address baked into the build, or `null` when it can only come from Rust.
 *
 * `VITE_BACKEND_URL` wins everywhere; otherwise a dev build falls back to
 * `http://127.0.0.1:${VITE_BACKEND_PORT ?? 4317}` and a production build has no
 * address at all.
 */
export function backendBaseUrlFromEnv(env: BackendEnv): string | null {
  const override = env.VITE_BACKEND_URL?.trim();
  if (override) return parseBaseUrl(override);
  if (!env.DEV) return null;
  const port = parsePort(env.VITE_BACKEND_PORT, "VITE_BACKEND_PORT") ?? DEFAULT_DEV_BACKEND_PORT;
  return `http://127.0.0.1:${port}`;
}

function normaliseInfo(payload: unknown): BackendInfoPayload {
  if (typeof payload === "number") return { port: payload, token: null };
  if (isRecord(payload)) {
    const port = payload.port;
    if (typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535) {
      const token = typeof payload.token === "string" && payload.token.length > 0 ? payload.token : null;
      return { port, token };
    }
  }
  throw new Error(`Unexpected backend info from Rust: ${JSON.stringify(payload)}`);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Ask Rust for the sidecar's port: via the command, or the ready event. */
async function backendInfoFromTauri(timeoutMs = STARTUP_TIMEOUT_MS): Promise<BackendInfoPayload> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error(
      "No backend address: this build has no VITE_BACKEND_URL and is not running inside Tauri, " +
        "so the backend port is unknown.",
    );
  }

  const [{ invoke }, { listen }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);

  let unlisten: (() => void) | undefined;
  const fromEvent = new Promise<BackendInfoPayload>((resolve) => {
    void listen<unknown>(READY_EVENT, (event) => resolve(normaliseInfo(event.payload))).then((stop) => {
      unlisten = stop;
    });
  });

  // The command can wait for startup itself; the event covers a backend that
  // reports in after the command already gave up. Whichever answers first wins.
  const fromCommand = invoke<unknown>("get_backend_info").then(normaliseInfo);

  try {
    const winner = await withTimeout(
      Promise.race([fromCommand, fromEvent]),
      timeoutMs,
      `The backend did not become ready within ${timeoutMs} ms.`,
    );
    return winner;
  } finally {
    // Silences an unhandled rejection from whichever promise lost the race.
    void fromCommand.catch(() => undefined);
    unlisten?.();
  }
}

let cached: Promise<BackendTarget> | null = null;

/** Resolve once per session; safe to call from everywhere that needs the API. */
export function getBackendTarget(): Promise<BackendTarget> {
  cached ??= resolveBackendTarget().catch((error: unknown) => {
    // Do not cache a failure: the next call may find the backend running.
    cached = null;
    throw error;
  });
  return cached;
}

/** Forget the resolved address, e.g. after the backend restarted on a new port. */
export function resetBackendTarget(): void {
  cached = null;
}

async function resolveBackendTarget(): Promise<BackendTarget> {
  const env = import.meta.env;
  const fromEnv = backendBaseUrlFromEnv({
    DEV: env.DEV,
    VITE_BACKEND_PORT: env.VITE_BACKEND_PORT,
    VITE_BACKEND_URL: env.VITE_BACKEND_URL,
  });
  if (fromEnv) return { baseUrl: fromEnv, token: null };

  const info = await backendInfoFromTauri();
  return { baseUrl: `http://127.0.0.1:${info.port}`, token: info.token ?? null };
}
