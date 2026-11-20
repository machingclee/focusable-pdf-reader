/**
 * Where the API's base URL comes from, with a test seam.
 *
 * In the app the address is resolved at runtime (`backendConfig.ts`: a fixed port
 * in dev, the Rust-provided port in a packaged build). Integration tests spawn the
 * backend on a random port, so they override it here instead of trying to fake a
 * Tauri environment. Production never calls the setter, so this is a no-op there.
 */
import { getBackendTarget, type BackendTarget } from "../../backendConfig";

let override: BackendTarget | null = null;

/** Test-only: pin the backend address (pass `null` to go back to the real one). */
export function setBackendTargetOverride(target: BackendTarget | null): void {
  override = target;
}

export async function resolveBackendTarget(): Promise<BackendTarget> {
  return override ?? getBackendTarget();
}
