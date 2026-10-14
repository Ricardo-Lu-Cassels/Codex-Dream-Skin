import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../runtime/startup-intro.js', import.meta.url), 'utf8');
const image = 'data:image/jpeg;base64,YWJjZA==';

function fixture({ reduced = false, imageError = false, paintError = false } = {}) {
  const frames = new Map();
  const timers = new Map();
  const paints = [];
  const gradientStops = [];
  let fills = 0;
  let identifier = 0;
  class Events {
    listeners = new Map();
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(callback);
    }
    removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
    dispatch(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn(event); }
    count() { return [...this.listeners.values()].reduce((count, set) => count + set.size, 0); }
  }
  const context = new Proxy({
    measureText: (text) => ({ width: text.length * 8 }),
    createRadialGradient: () => ({ addColorStop(_position, color) { gradientStops.push(color); } }),
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() { fills += 1; },
    drawImage(...args) { if (paintError) throw new Error('paint failed'); paints.push(args); },
  }, { get(target, name) { return name in target ? target[name] : () => {}; } });
  class Element extends Events {
    children = [];
    styles = {};
    attributes = {};
    constructor(tag) { super(); this.tag = tag; this.style = { setProperty: (name, value) => { this.styles[name] = value; } }; }
    append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
    setAttribute(name, value) { this.attributes[name] = value; }
    attachShadow() { this.shadowRoot = new Element('shadow'); return this.shadowRoot; }
    getContext() { return context; }
  }
  const document = new Events();
  document.documentElement = new Element('html');
  document.createElement = (tag) => new Element(tag);
  document.hidden = false;
  const window = new Events();
  Object.assign(window, { innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1.5, matchMedia: () => ({ matches: reduced }) });
  class MockImage {
    naturalWidth = 1672;
    naturalHeight = 941;
    set src(value) { this.value = value; queueMicrotask(() => imageError ? this.onerror?.() : this.onload?.()); }
  }
  const sandbox = vm.createContext({
    window, document, Image: MockImage,
    requestAnimationFrame(fn) { const id = ++identifier; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn) { const id = ++identifier; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(source, sandbox);
  return {
    window, document, frames, timers, paints, gradientStops, fills: () => fills,
    mount: (options = {}) => window.DreamSkinStartupIntro.mount({ image, ...options }),
    flush: async () => { await new Promise((resolve) => setImmediate(resolve)); },
    frame(time) { const entry = frames.entries().next().value; assert.ok(entry); frames.delete(entry[0]); entry[1](time); },
    assertClean() {
      assert.equal(document.documentElement.children.length, 0);
      assert.equal(window.count(), 0);
      assert.equal(document.count(), 0);
      assert.equal(frames.size, 0);
      assert.equal(timers.size, 0);
    },
  };
}

test('finishes and removes only its own isolated host and all listeners', async () => {
  const f = fixture();
  const native = { parent: f.document.documentElement };
  f.document.documentElement.children.push(native);
  let coverRemoved = 0;
  f.window.__CODEX_DREAM_SKIN_STARTUP_COVER__ = { remove() { coverRemoved += 1; } };
  const run = f.mount({ closedImage: image });
  await f.flush();
  assert.equal(coverRemoved, 1);
  const host = f.document.documentElement.children[1];
  assert.ok(host.shadowRoot);
  assert.equal(host.styles.position, 'fixed');
  assert.equal(host.styles.background, '#050a0f');
  f.frame(1000);
  f.frame(13001);
  assert.equal((await run.finished).reason, 'completed');
  assert.deepEqual(f.document.documentElement.children, [native]);
  f.document.documentElement.children.pop();
  f.assertClean();
});

test('same live invocation is idempotent and a completed intro needs explicit replay', async () => {
  const f = fixture();
  const run = f.mount();
  assert.equal(f.mount(), run);
  await f.flush();
  run.skip();
  assert.equal((await f.mount().finished).reason, 'already-played');
  const replay = f.mount({ replay: true });
  assert.notEqual(replay, run);
  await f.flush();
  replay.skip();
  f.assertClean();
});

for (const cause of ['click', 'Escape', 'hidden']) {
  test(`${cause} releases the app immediately`, async () => {
    const f = fixture();
    const run = f.mount();
    await f.flush();
    if (cause === 'click') f.document.documentElement.children[0].dispatch('click');
    if (cause === 'Escape') f.document.dispatch('keydown', { key: 'Escape' });
    if (cause === 'hidden') { f.document.hidden = true; f.document.dispatch('visibilitychange'); }
    assert.equal((await run.finished).reason, cause === 'hidden' ? 'hidden' : 'skipped');
    f.assertClean();
  });
}

test('reduced motion and external image URLs leave the app untouched', async () => {
  const f = fixture({ reduced: true });
  let coverRemoved = 0;
  f.window.__CODEX_DREAM_SKIN_STARTUP_COVER__ = { remove() { coverRemoved += 1; } };
  assert.equal((await f.mount().finished).reason, 'reduced-motion');
  assert.equal(coverRemoved, 1);
  f.assertClean();
  const other = fixture();
  assert.equal((await other.mount({ image: 'https://example.com/image.jpg' }).finished).reason, 'invalid-image');
  other.assertClean();
});

test('a failed image and a stalled animation both clean up', async () => {
  const f = fixture({ imageError: true });
  const failed = f.mount();
  await f.flush();
  assert.equal((await failed.finished).reason, 'image-error');
  f.assertClean();
  const stalled = fixture();
  const run = stalled.mount();
  await stalled.flush();
  [...stalled.timers.values()][0]();
  assert.equal((await run.finished).reason, 'deadline');
  stalled.assertClean();
});

test('silver-eye close-up opens, resolves into wallpaper, then fades to Codex', async () => {
  const f = fixture();
  const closed = 'data:image/jpeg;base64,Y2xvc2Vk';
  const run = f.mount({ autoplay: false, closedImage: closed });
  await f.flush();
  assert.equal(await run.ready, true);
  assert.equal(f.frames.size, 0);
  f.window.innerWidth = 1200;
  f.window.innerHeight = 700;
  f.window.dispatch('resize');
  assert.equal(run.renderAt(4200), true);
  assert.ok(f.paints.some((paint) => paint[0].value === closed && paint[3] > 2 * 1672));
  assert.equal(f.gradientStops.some((color) => String(color).startsWith('rgba(244,251,255,')), false);
  assert.equal(run.renderAt(4800), true);
  assert.equal(f.paints.at(-1)[0].value, image);
  assert.ok(f.gradientStops.some((color) => String(color).startsWith('rgba(244,251,255,')));
  assert.equal(run.renderAt(8800), true);
  const host = f.document.documentElement.children[0];
  const canvas = host.shadowRoot.children[1];
  assert.equal(canvas.width, 1800);
  assert.equal(canvas.height, 1050);
  const last = f.paints.at(-1);
  assert.equal(last[0].value, image);
  assert.equal(last[3], Math.max(1200 / 1672, 700 / 941) * 1672);
  assert.equal(last[4], Math.max(1200 / 1672, 700 / 941) * 941);
  assert.equal(run.renderAt(11425), true);
  assert.ok(Math.abs(Number(host.styles.opacity) - 0.5) < 1e-9);
  run.skip();
  f.assertClean();
});

test('silver particles disperse visibly across the HUD transition', async () => {
  const f = fixture();
  const run = f.mount({ autoplay: false });
  await f.flush();
  assert.equal(run.renderAt(2900), true);
  assert.ok(f.fills() > 600);
  run.skip();
  f.assertClean();
});

test('render failure must not leave a scheduled animation behind', async () => {
  const f = fixture({ paintError: true });
  const run = f.mount();
  await f.flush();
  run.renderAt(1000);
  assert.equal((await run.finished).reason, 'render-error');
  f.assertClean();
});
