import { describe, expect, test } from "bun:test";
import { DEFAULT_DEV_BACKEND_PORT, backendBaseUrlFromEnv } from "../src/backendConfig";

describe("backendBaseUrlFromEnv", () => {
  test("dev falls back to the default port from backend/package.json", () => {
    expect(backendBaseUrlFromEnv({ DEV: true })).toBe(`http://127.0.0.1:${DEFAULT_DEV_BACKEND_PORT}`);
    expect(DEFAULT_DEV_BACKEND_PORT).toBe(4317);
  });

  test("dev honours VITE_BACKEND_PORT", () => {
    expect(backendBaseUrlFromEnv({ DEV: true, VITE_BACKEND_PORT: "4555" })).toBe("http://127.0.0.1:4555");
    expect(backendBaseUrlFromEnv({ DEV: true, VITE_BACKEND_PORT: " 4555 " })).toBe("http://127.0.0.1:4555");
  });

  test("a production build bakes in no address, so Rust must supply the port", () => {
    expect(backendBaseUrlFromEnv({ DEV: false })).toBeNull();
    expect(backendBaseUrlFromEnv({ DEV: false, VITE_BACKEND_PORT: "4317" })).toBeNull();
  });

  test("VITE_BACKEND_URL wins in both modes", () => {
    expect(backendBaseUrlFromEnv({ DEV: true, VITE_BACKEND_URL: "http://127.0.0.1:9999", VITE_BACKEND_PORT: "4317" })).toBe(
      "http://127.0.0.1:9999",
    );
    expect(backendBaseUrlFromEnv({ DEV: false, VITE_BACKEND_URL: "http://127.0.0.1:9999" })).toBe("http://127.0.0.1:9999");
    expect(backendBaseUrlFromEnv({ DEV: false, VITE_BACKEND_URL: " https://example.test " })).toBe("https://example.test");
  });

  test("trailing slashes are removed so paths concatenate cleanly", () => {
    expect(backendBaseUrlFromEnv({ DEV: true, VITE_BACKEND_URL: "http://127.0.0.1:4317///" })).toBe("http://127.0.0.1:4317");
  });

  test("a bad port fails loudly instead of silently using 4317", () => {
    expect(() => backendBaseUrlFromEnv({ DEV: true, VITE_BACKEND_PORT: "abc" })).toThrow(/must be a number/);
    expect(() => backendBaseUrlFromEnv({ DEV: true, VITE_BACKEND_PORT: "0" })).toThrow(/between 1 and 65535/);
    expect(() => backendBaseUrlFromEnv({ DEV: true, VITE_BACKEND_PORT: "70000" })).toThrow(/between 1 and 65535/);
  });

  test("a bad url fails loudly", () => {
    expect(() => backendBaseUrlFromEnv({ DEV: false, VITE_BACKEND_URL: "127.0.0.1:4317" })).toThrow(/must look like/);
  });
});
