/**
 * Helpers for the bottom-right backend pill.
 *
 * The backend documents itself from the Zod schemas (`backend/src/schemas.ts`):
 * Swagger UI at `/api-docs`, the OpenAPI document at `/api-docs.json`. See the
 * "Swagger" section of `backend/README.md`.
 *
 * Kept free of React and of `import.meta.env` so it can be unit tested.
 */

/** Swagger UI path, registered by `setupSwagger` in `backend/src/app.ts`. */
export const API_DOCS_PATH = "/api-docs";

/** The interactive docs for a backend base URL, e.g. `http://127.0.0.1:4317/api-docs`. */
export function apiDocsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${API_DOCS_PATH}`;
}

/**
 * Short form of the address for the pill: `http://127.0.0.1:4317` becomes
 * `localhost:4317`, because that is what people type in a browser bar.
 * Any other host is shown as-is, with its port when it has one.
 */
export function backendAddressLabel(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return baseUrl;
  }
  const { hostname } = url;
  const host = hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]" ? "localhost" : hostname;
  return url.port ? `${host}:${url.port}` : host;
}
