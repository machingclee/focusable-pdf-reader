import { describe, expect, test } from "bun:test";
import { apiErrorMessage } from "../src/store/api/baseApi";
import appSlice, { clearBackend, setBackend } from "../src/store/slices/appSlice";

describe("appSlice", () => {
  test("starts without backend credentials", () => {
    expect(appSlice.reducer(undefined, { type: "@@init" })).toEqual({
      backendBaseUrl: null,
      backendToken: null,
    });
  });

  test("keeps the resolved address and token, and can clear them", () => {
    const withBackend = appSlice.reducer(
      undefined,
      setBackend({ baseUrl: "http://127.0.0.1:4317", token: "abc123" }),
    );
    expect(withBackend).toEqual({ backendBaseUrl: "http://127.0.0.1:4317", backendToken: "abc123" });

    expect(appSlice.reducer(withBackend, clearBackend())).toEqual({
      backendBaseUrl: null,
      backendToken: null,
    });
  });

  test("accepts a backend without a token (dev mode)", () => {
    const withBackend = appSlice.reducer(undefined, setBackend({ baseUrl: "http://127.0.0.1:4317", token: null }));
    expect(withBackend.backendToken).toBeNull();
  });
});

describe("apiErrorMessage", () => {
  test("reads the backend's { error } envelope", () => {
    expect(apiErrorMessage({ status: 400, data: { error: "Validation failed", details: [] } })).toBe(
      "Validation failed",
    );
  });

  test("passes through resolution and network failures", () => {
    expect(apiErrorMessage({ status: "CUSTOM_ERROR", error: "the backend did not report a port" })).toBe(
      "the backend did not report a port",
    );
    expect(apiErrorMessage({ status: "FETCH_ERROR", error: "TypeError: Failed to fetch" })).toBe(
      "The backend is not reachable",
    );
  });

  test("falls back to the status code or the thrown message", () => {
    expect(apiErrorMessage({ status: 500, data: null })).toBe("Request failed (500)");
    expect(apiErrorMessage({ name: "Error", message: "boom" })).toBe("boom");
    expect(apiErrorMessage(undefined)).toBeNull();
  });
});
