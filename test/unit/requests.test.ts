import { describe, expect, it } from "vitest";
import { isAppFile, isDevRequest, isRendererDocument } from "../../src/core/requests";

describe("resource request containment", () => {
  it("accepts Windows packaged URLs with spaces and rejects prefix siblings", () => {
    const root = "C:\\Users\\test\\AppData\\Local\\Simple MD\\resources\\app.asar";
    const base = "file:///C:/Users/test/AppData/Local/Simple%20MD/resources/";
    expect(isAppFile(`${base}app.asar/.vite/renderer/main_window/index.html`, root, true)).toBe(
      true,
    );
    expect(
      isRendererDocument(`${base}app.asar/.vite/renderer/main_window/index.html`, root, true),
    ).toBe(true);
    expect(
      isRendererDocument(`${base}app.asar/evil/renderer/main_window/index.html`, root, true),
    ).toBe(false);
    expect(isAppFile(`${base}app.asar.unpacked/assets/font.woff2`, root, true)).toBe(true);
    expect(isAppFile(`${base}app.asar-evil/index.html`, root, true)).toBe(false);
    expect(isAppFile(`${base}app.asar/../secret.md`, root, true)).toBe(false);
    expect(isAppFile(`${base}app.asar/%2fsecret`, root, true)).toBe(false);
  });

  it("accepts POSIX packaged resources and rejects paths merely containing the root", () => {
    const root = "/Applications/Simple MD.app/Contents/Resources/app.asar";
    expect(isAppFile(`file://${root}/.vite/renderer/main_window/index.html`, root, false)).toBe(
      true,
    );
    expect(isAppFile(`file:///tmp${root}/index.html`, root, false)).toBe(false);
    expect(isAppFile(`file://${root}-evil/index.html`, root, false)).toBe(false);
    expect(isAppFile("https://example.com/index.html", root, false)).toBe(false);
    expect(isAppFile("file:///%ZZ", root, false)).toBe(false);
  });

  it("uses the exact development host and port, including its websocket", () => {
    const dev = "http://127.0.0.1:5173/";
    expect(isDevRequest(`${dev}src/main.tsx`, dev)).toBe(true);
    expect(isDevRequest("ws://127.0.0.1:5173/", dev)).toBe(true);
    expect(isDevRequest("http://127.0.0.1:51730/", dev)).toBe(false);
    expect(isDevRequest("http://127.0.0.1:5173.evil.com/", dev)).toBe(false);
    expect(isDevRequest("ws://localhost:9999/", dev)).toBe(false);
  });
});
