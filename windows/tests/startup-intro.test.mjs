import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { assertBrowserIdentity, isCleanIntroResult, isCodexPageTarget, nativeProbeExpression, parseArgs,
  readLocalImage, readThemeImage, validateDebuggerUrl } from "../scripts/startup-intro.mjs";

const port = 9335;
const validPage = { id: "codex-page", type: "page", url: "app://-/index.html",
  webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/codex-page` };

test("CDP is restricted to the same-port loopback endpoint", () => {
  assert.equal(validateDebuggerUrl(validPage.webSocketDebuggerUrl, port, "page"), validPage.webSocketDebuggerUrl);
  for (const url of ["ws://example.com:9335/devtools/page/codex-page",
    "ws://127.0.0.1:9336/devtools/page/codex-page", "wss://127.0.0.1:9335/devtools/page/codex-page",
    "ws://user:password@127.0.0.1:9335/devtools/page/codex-page",
    "ws://127.0.0.1:9335/devtools/page/codex-page?token=1",
    "ws://127.0.0.1:9335/devtools/browser/codex-page", "ws://127.0.0.1:9335/devtools/page/a%2Fb"]) {
    assert.throws(() => validateDebuggerUrl(url, port, "page"));
  }
});

test("a reused port cannot replace the launch-time browser identity", () => {
  const version = { webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/current-browser` };
  assert.equal(assertBrowserIdentity(version, port, "current-browser"), version.webSocketDebuggerUrl);
  assert.throws(() => assertBrowserIdentity(version, port, "previous-browser"), /Browser ID changed/);
});

test("pets, blank pages and target-ID mismatches are excluded", () => {
  assert.equal(isCodexPageTarget(validPage, port), true);
  for (const target of [{ ...validPage, url: "about:blank" },
    { ...validPage, url: "app://-/avatar-overlay-composition-surface.html" },
    { ...validPage, url: "app://-/index.html?initialRoute=%2Favatar-overlay%2Fpet" },
    { ...validPage, id: "other-page" }, { ...validPage, type: "iframe" }]) {
    assert.equal(isCodexPageTarget(target, port), false);
  }
});

test("renderer probing requires visible native Codex and the working wallpaper", () => {
  const selectors = { selectors: [{ key: "shell-main", selector: "main.native" },
    { key: "left-panel", selector: "aside.native" }, { key: "home-route", selector: "main.home" }] };
  const expression = nativeProbeExpression(selectors);
  const context = { URLSearchParams, window: {}, location: { protocol: "app:", pathname: "/index.html", search: "" },
    innerWidth: 1280, innerHeight: 800, document: { visibilityState: "visible", hasFocus: () => true,
      querySelector: (selector) => ["main.native", "aside.native"].includes(selector) ? {} : null,
      getElementById: () => ({}) } };
  assert.equal(vm.runInNewContext(expression, context).codex, true);
  context.document.getElementById = () => null;
  assert.equal(vm.runInNewContext(expression, context).codex, false);
  context.document.getElementById = () => ({});
  context.document.visibilityState = "hidden";
  assert.equal(vm.runInNewContext(expression, context).codex, false);
});

test("a registered adopted wallpaper is active only while its real sheet remains installed", () => {
  const selectors = { selectors: [{ key: "shell-main", selector: "main.native" },
    { key: "left-panel", selector: "aside.native" }, { key: "home-route", selector: "main.home" }] };
  const sheet = {};
  const context = { URLSearchParams,
    window: { __CODEX_DREAM_SKIN_STATE__: { styleMode: "adopted", styleSheet: sheet } },
    location: { protocol: "app:", pathname: "/index.html", search: "" },
    innerWidth: 1280, innerHeight: 800, document: { visibilityState: "visible", hasFocus: () => true,
      querySelector: (selector) => ["main.native", "aside.native"].includes(selector) ? {} : null,
      getElementById: () => null, adoptedStyleSheets: [sheet] } };
  const expression = nativeProbeExpression(selectors);
  assert.equal(vm.runInNewContext(expression, context).codex, true);
  context.document.adoptedStyleSheets = [];
  assert.equal(vm.runInNewContext(expression, context).codex, false);
  context.document.adoptedStyleSheets = [{}];
  assert.equal(vm.runInNewContext(expression, context).codex, false);
});

test("renderer failures and watchdog deadlines do not claim clean completion", () => {
  for (const reason of ["completed", "skipped", "hidden", "reduced-motion", "already-played"]) {
    assert.equal(isCleanIntroResult({ reason }), true);
  }
  for (const reason of ["invalid-image", "canvas-unavailable", "image-error", "render-error", "deadline", "image-timeout"]) {
    assert.equal(isCleanIntroResult({ reason }), false);
  }
  assert.equal(isCleanIntroResult(null), false);
  assert.equal(isCleanIntroResult({}), false);
});

test("launch durations include the reference 12-second sequence", () => {
  assert.equal(parseArgs(["--duration-ms", "1800"]).durationMs, 1800);
  assert.equal(parseArgs(["--duration-ms", "12000"]).durationMs, 12000);
  assert.equal(parseArgs(["--duration-ms", "15000"]).durationMs, 15000);
  for (const duration of ["1000", "1799", "15001", "18000", "12000.5"]) {
    assert.throws(() => parseArgs(["--duration-ms", duration]), /out of range/);
  }
});

test("active themes cannot read outside their local image or supply remote URLs", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dreamskin-intro-theme-"));
  try {
    for (const image of ["../private.jpg", "..\\private.jpg", "C:\\private.jpg",
      "https://example.com/art.jpg", "data:image/png;base64,a", "art.jpg:stream", "CON.jpg"]) {
      await fs.writeFile(path.join(directory, "theme.json"), JSON.stringify({ schemaVersion: 1, image }));
      await assert.rejects(readThemeImage(directory), /one local image filename/);
    }
    const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6RrQAAAAASUVORK5CYII=", "base64");
    await fs.writeFile(path.join(directory, "art.png"), tinyPng);
    await fs.writeFile(path.join(directory, "theme.json"), JSON.stringify({ schemaVersion: 1, image: "art.png" }));
    assert.match(await readThemeImage(directory), /^data:image\/png;base64,/);
    await fs.writeFile(path.join(directory, "empty.jpg"), "");
    await assert.rejects(readLocalImage(path.join(directory, "empty.jpg")), /empty or exceeds/);
    await fs.writeFile(path.join(directory, "large.png"), Buffer.alloc(10 * 1024 * 1024 + 1));
    await assert.rejects(readLocalImage(path.join(directory, "large.png")), /empty or exceeds/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("a redirected theme directory cannot read an external image", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dreamskin-intro-link-"));
  try {
    const realTheme = path.join(directory, "actual-theme");
    const linkedTheme = path.join(directory, "redirected-theme");
    await fs.mkdir(realTheme);
    await fs.writeFile(path.join(realTheme, "theme.json"), JSON.stringify({ schemaVersion: 1, image: "art.png" }));
    await fs.symlink(realTheme, linkedTheme, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(readThemeImage(linkedTheme), /redirected by a link/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
