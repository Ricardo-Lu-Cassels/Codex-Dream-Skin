import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readImageMetadata } from "../../runtime/image-metadata.mjs";

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const ID = /^[A-Za-z0-9._-]{1,200}$/;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const CLEAN_INTRO_REASONS = new Set(["completed", "skipped", "hidden", "reduced-motion", "already-played"]);

export function isCleanIntroResult(result) {
  return typeof result?.reason === "string" && CLEAN_INTRO_REASONS.has(result.reason);
}

export function validateDebuggerUrl(value, port, kind) {
  if (!["page", "browser"].includes(kind)) throw new Error("Unexpected CDP endpoint kind.");
  const url = new URL(value);
  if (url.protocol !== "ws:" || !LOOPBACK.has(url.hostname) ||
    Number(url.port) !== port || url.username || url.password || url.search || url.hash ||
    !new RegExp(`^/devtools/${kind}/[A-Za-z0-9._-]{1,200}$`).test(url.pathname)) {
    throw new Error("Rejected an invalid or non-loopback CDP endpoint.");
  }
  return url.href;
}

export function assertBrowserIdentity(version, port, expectedId) {
  if (!ID.test(expectedId)) throw new Error("Invalid recorded Browser ID.");
  const url = new URL(validateDebuggerUrl(version?.webSocketDebuggerUrl, port, "browser"));
  if (url.pathname !== `/devtools/browser/${expectedId}`) {
    throw new Error("The Codex Browser ID changed; no intro was injected.");
  }
  return url.href;
}

export function isCodexPageTarget(target, port) {
  if (target?.type !== "page" || typeof target.id !== "string" || !ID.test(target.id)) return false;
  try {
    const page = new URL(target.url);
    const initial = page.searchParams.get("initialRoute") || "";
    if (page.protocol !== "app:" || page.pathname.endsWith("/avatar-overlay-composition-surface.html") ||
      initial === "/avatar-overlay" || initial.startsWith("/avatar-overlay/")) return false;
    return new URL(validateDebuggerUrl(target.webSocketDebuggerUrl, port, "page")).pathname ===
      `/devtools/page/${target.id}`;
  } catch { return false; }
}

async function readBoundedFile(filename, maxBytes) {
  const absolute = path.resolve(filename);
  // Reject symbolic links and Windows junctions in every existing component.
  for (let item = absolute; ; item = path.dirname(item)) {
    const info = await fs.lstat(item);
    if (info.isSymbolicLink()) throw new Error("A local intro asset is redirected by a link.");
    if (item === absolute && !info.isFile()) throw new Error("An intro asset must be a regular file.");
    if (path.dirname(item) === item) break;
  }
  const handle = await fs.open(absolute, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > maxBytes) {
      throw new Error("A local intro file is empty or exceeds its size limit.");
    }
    const bytes = Buffer.alloc(Math.min(maxBytes + 1, info.size + 1));
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length !== info.size) throw new Error("A local intro file changed while it was read.");
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

export async function readLocalImage(filename) {
  const bytes = await readBoundedFile(filename, MAX_IMAGE_BYTES);
  const extension = path.extname(filename).toLowerCase();
  const mime = extension === ".png" && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png" : [".jpg", ".jpeg"].includes(extension) && bytes[0] === 255 && bytes[1] === 216
      ? "image/jpeg" : extension === ".webp" && bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
  if (!mime || !readImageMetadata(bytes, extension)) {
    throw new Error("The intro image format or dimensions are invalid.");
  }
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

export async function readThemeImage(themeDirectory) {
  const bytes = await readBoundedFile(path.join(themeDirectory, "theme.json"), 64 * 1024);
  const theme = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (theme?.schemaVersion !== 1 || typeof theme.image !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,239}\.(?:png|jpe?g|webp)$/i.test(theme.image) ||
    /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(theme.image)) {
    throw new Error("The active theme must reference one local image filename.");
  }
  return readLocalImage(path.join(themeDirectory, theme.image));
}

export function nativeProbeExpression(selectors) {
  const find = (key) => {
    const selector = selectors?.selectors?.find((entry) => entry.key === key)?.selector;
    if (typeof selector !== "string" || !selector || selector.length > 2048) {
      throw new Error("The installed Codex selector contract is incomplete.");
    }
    return JSON.stringify(selector);
  };
  return `(() => {
    const initial = new URLSearchParams(location.search).get('initialRoute') || '';
    const pet = location.pathname.endsWith('/avatar-overlay-composition-surface.html') ||
      initial === '/avatar-overlay' || initial.startsWith('/avatar-overlay/');
    const shell = !!document.querySelector(${find("shell-main")});
    const sidebar = !!document.querySelector(${find("left-panel")});
    const nativeHeader = !!document.querySelector('[data-testid="app-shell-header-context-menu-surface"]');
    const generic = !!document.querySelector('main, [role="main"]') && nativeHeader &&
      !!document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
    const home = !!document.querySelector(${find("home-route")});
    const visible = document.visibilityState === 'visible' && innerWidth >= 320 && innerHeight >= 240;
    const skin = window.__CODEX_DREAM_SKIN_STATE__;
    const wallpaper = !!document.getElementById('codex-dream-skin-style') ||
      (skin?.styleMode === 'adopted' && !!skin.styleSheet &&
        Array.from(document.adoptedStyleSheets || []).includes(skin.styleSheet));
    return {codex: location.protocol === 'app:' && !pet && visible &&
      ((shell && sidebar) || home || generic) && wallpaper,
      focused: document.hasFocus()};
  })()`;
}

async function fetchJson(port, route) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    redirect: "error", signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error("The local Codex CDP endpoint did not respond.");
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 256 * 1024) {
      throw new Error("The local CDP response exceeds its size limit.");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

class CdpSession {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.closed = false;
    this.socket.addEventListener("message", ({ data }) => {
      let result;
      try { result = JSON.parse(String(data)); } catch { this.close(); return; }
      const waiter = this.pending.get(result.id);
      if (!waiter) return;
      this.pending.delete(result.id);
      clearTimeout(waiter.timer);
      if (result.error) waiter.reject(new Error("A Codex CDP command failed."));
      else waiter.resolve(result.result);
    });
    this.socket.addEventListener("close", () => {
      this.closed = true;
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("The verified Codex session closed."));
      }
      this.pending.clear();
    });
  }
  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.close(); reject(new Error("CDP connection timed out.")); }, 2500);
      this.socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timer); reject(new Error("CDP connection failed."));
      }, { once: true });
    });
    return this;
  }
  send(method, params, timeoutMs = 5000) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("The verified Codex session is unavailable."));
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The Codex renderer did not answer in time."));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async evaluate(expression, timeoutMs = 5000) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (result.exceptionDetails) throw new Error("The startup intro renderer rejected its payload.");
    return result.result?.value;
  }
  close() { try { this.socket.close(); } catch {} }
}

async function verifyStoreOwner(commonScript, statePath, state) {
  const literal = (value) => `'${value.replaceAll("'", "''")}'`;
  const command = `$ErrorActionPreference='Stop'; . ${literal(commonScript)};
    $state=Read-DreamSkinState -Path ${literal(statePath)};
    if ($state.browserId -cne ${literal(state.browserId)} -or [int]$state.port -ne ${state.port}) { throw 'Session changed.' };
    $codex=Get-DreamSkinCodexInstallFromState -State $state;
    if ($null -eq $codex) { throw 'Not a registered Codex Store package.' };
    $identity=Get-DreamSkinVerifiedCdpIdentity -Port ([int]$state.port) -Codex $codex;
    if ($null -eq $identity -or $identity.BrowserId -cne $state.browserId) { throw 'Session owner changed.' };
    [Console]::Out.Write('verified')`;
  const powershell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  let result;
  try {
    result = await execute(powershell, ["-NoProfile", "-ExecutionPolicy", "RemoteSigned", "-EncodedCommand",
      Buffer.from(command, "utf16le").toString("base64")], { windowsHide: true, timeout: 15000, maxBuffer: 65536 });
  } catch { throw new Error("The Codex Store listener owner could not be verified."); }
  if (result.stdout.trim() !== "verified") throw new Error("The Codex Store listener owner could not be verified.");
}

export async function runStartupIntro(options) {
  if (process.platform !== "win32") throw new Error("The startup launcher currently requires Windows.");
  const stateRoot = path.join(process.env.LOCALAPPDATA, "CodexDreamSkin");
  const payloadRoot = path.join(process.env.LOCALAPPDATA, "Programs", "CodexDreamSkin", "payload");
  const statePath = path.join(stateRoot, "state.json");
  const state = JSON.parse((await readBoundedFile(statePath, 65536)).toString("utf8"));
  if (state?.schemaVersion !== 3 || state.platform !== "windows" ||
    !Number.isInteger(state.port) || state.port < 1024 || state.port > 65535 ||
    typeof state.browserId !== "string" || !ID.test(state.browserId)) {
    throw new Error("No valid current Dream Skin session is available.");
  }
  await verifyStoreOwner(path.join(payloadRoot, "scripts", "common-windows.ps1"), statePath, state);
  const [image, closedImage, renderer, selectorBytes] = await Promise.all([
    readThemeImage(path.join(stateRoot, "active-theme")),
    options.closedImage ? readLocalImage(options.closedImage) : undefined,
    readBoundedFile(options.renderer, 256 * 1024),
    readBoundedFile(path.join(payloadRoot, "assets", "selectors.json"), 128 * 1024),
  ]);
  const probe = nativeProbeExpression(JSON.parse(selectorBytes.toString("utf8")));
  const anchorUrl = assertBrowserIdentity(await fetchJson(state.port, "/json/version"), state.port, state.browserId);
  const anchor = new CdpSession(anchorUrl);
  const sessions = [];
  try {
    await anchor.open();
    const deadline = Date.now() + options.timeoutMs;
    let selected;
    while (!selected && Date.now() < deadline) {
      if (anchor.closed) throw new Error("The launch-time Codex browser closed.");
      assertBrowserIdentity(await fetchJson(state.port, "/json/version"), state.port, state.browserId);
      const targets = await fetchJson(state.port, "/json/list");
      if (!Array.isArray(targets) || targets.length > 64) throw new Error("Unexpected local CDP target list.");
      const candidates = [];
      for (const target of targets.filter((item) => isCodexPageTarget(item, state.port))) {
        if (Date.now() >= deadline || anchor.closed) break;
        const session = new CdpSession(validateDebuggerUrl(target.webSocketDebuggerUrl, state.port, "page"));
        sessions.push(session);
        try {
          await session.open();
          const result = await session.evaluate(probe);
          if (result?.codex) candidates.push({ session, focused: result.focused });
          else session.close();
        } catch { session.close(); }
      }
      selected = candidates.find((candidate) => candidate.focused) || candidates[0];
      for (const candidate of candidates) if (candidate !== selected) candidate.session.close();
      if (!selected) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!selected) throw new Error("No visible native Codex window with an active wallpaper was ready.");
    // The original browser socket remains open throughout this single invocation.
    await verifyStoreOwner(path.join(payloadRoot, "scripts", "common-windows.ps1"), statePath, state);
    if (anchor.closed || !(await selected.session.evaluate(probe))?.codex) {
      throw new Error("The native Codex renderer changed before the intro could start.");
    }
    const payload = { image, closedImage, title: "Master", durationMs: options.durationMs, replay: options.replay };
    const expression = `(async () => {
      ${renderer.toString("utf8")}
      const intro = window.DreamSkinStartupIntro.mount(${JSON.stringify(payload)});
      try {
        const result = await intro.finished;
        return {result: result ?? null};
      } finally { intro.skip?.(); }
    })()`;
    const result = await selected.session.evaluate(expression, options.durationMs + 10000);
    if (!isCleanIntroResult(result?.result)) throw new Error("The startup intro did not finish cleanly.");
    return { completed: true, result: result.result };
  } finally {
    for (const session of sessions) session.close();
    anchor.close();
  }
}

export function parseArgs(argv) {
  const options = { renderer: path.resolve(here, "../../runtime/startup-intro.js"),
    closedImage: null, replay: false, durationMs: 12000, timeoutMs: 15000 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--replay") options.replay = true;
    else if (argv[i] === "--renderer") options.renderer = path.resolve(argv[++i]);
    else if (argv[i] === "--closed-image") options.closedImage = path.resolve(argv[++i]);
    else if (argv[i] === "--duration-ms") options.durationMs = Number(argv[++i]);
    else if (argv[i] === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else throw new Error("Unsupported startup intro argument.");
  }
  if (!Number.isInteger(options.durationMs) || options.durationMs < 1800 || options.durationMs > 15000 ||
    !Number.isInteger(options.timeoutMs) || options.timeoutMs < 500 || options.timeoutMs > 30000) {
    throw new Error("The intro duration or readiness timeout is out of range.");
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await runStartupIntro(parseArgs(process.argv.slice(2)))));
  } catch (error) {
    console.error(`Startup intro skipped: ${error?.message || "Unknown local startup failure."}`);
    process.exitCode = 1;
  }
}
