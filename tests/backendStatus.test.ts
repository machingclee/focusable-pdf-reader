import { describe, expect, test } from "bun:test";
import { API_DOCS_PATH, apiDocsUrl, backendAddressLabel } from "../src/backendStatus";

describe("apiDocsUrl", () => {
  test("appends the Swagger UI path to the backend origin", () => {
    expect(API_DOCS_PATH).toBe("/api-docs");
    expect(apiDocsUrl("http://127.0.0.1:4317")).toBe("http://127.0.0.1:4317/api-docs");
    expect(apiDocsUrl("https://example.test")).toBe("https://example.test/api-docs");
  });

  test("tolerates the trailing slash VITE_BACKEND_URL may carry", () => {
    expect(apiDocsUrl("http://127.0.0.1:4317/")).toBe("http://127.0.0.1:4317/api-docs");
    expect(apiDocsUrl("http://127.0.0.1:4317///")).toBe("http://127.0.0.1:4317/api-docs");
  });
});

describe("backendAddressLabel", () => {
  test("shows a loopback address the way a browser bar would", () => {
    expect(backendAddressLabel("http://127.0.0.1:4317")).toBe("localhost:4317");
    expect(backendAddressLabel("http://127.0.0.1")).toBe("localhost");
    expect(backendAddressLabel("http://[::1]:4317")).toBe("localhost:4317");
  });

  test("keeps any other host, with its port", () => {
    expect(backendAddressLabel("http://192.168.1.20:8080")).toBe("192.168.1.20:8080");
    expect(backendAddressLabel("https://api.example.test")).toBe("api.example.test");
  });

  test("keeps the path the backend is mounted under, but not the empty root", () => {
    expect(backendAddressLabel("http://127.0.0.1:21930/api")).toBe("localhost:21930/api");
    expect(backendAddressLabel("http://127.0.0.1:21930/api/")).toBe("localhost:21930/api");
    expect(backendAddressLabel("http://127.0.0.1:21930/")).toBe("localhost:21930");
    expect(backendAddressLabel("http://127.0.0.1:21930///")).toBe("localhost:21930");
  });

  test("falls back to the raw value when the URL cannot be parsed", () => {
    expect(backendAddressLabel("not a url")).toBe("not a url");
  });
});
