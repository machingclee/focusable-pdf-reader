import { describe, expect, test } from "bun:test";
import { detectPlatform } from "../src/platform";

describe("detectPlatform", () => {
  test("recognises the WebView2 user agent a Windows build reports", () => {
    const userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0";
    expect(detectPlatform(userAgent)).toBe("windows");
  });

  test("recognises the WKWebView user agent a macOS build reports", () => {
    const userAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
    expect(detectPlatform(userAgent)).toBe("macos");
  });

  test("keeps Apple-shaped agents on the macOS layout, not on Windows'", () => {
    // An iPhone's agent claims "like Mac OS X" and an iPad's claims to be a Mac.
    // Neither runs this app, and neither should get Windows' chrome.
    for (const userAgent of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)",
    ]) {
      expect(detectPlatform(userAgent)).toBe("macos");
    }
  });

  test("answers other for anything it does not recognise", () => {
    expect(detectPlatform("")).toBe("other");
    expect(
      detectPlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)"),
    ).toBe("other");
  });
});
