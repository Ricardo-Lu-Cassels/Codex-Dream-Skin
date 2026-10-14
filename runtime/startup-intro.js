// Optional, isolated startup decoration. It never alters the native app DOM.
(() => {
  if (window.DreamSkinStartupIntro) return;
  const VERSION = 1;
  const MAX_IMAGE_LENGTH = 15 * 1024 * 1024;
  let active = null;
  let played = false;
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const ease = (value) => { const t = clamp(value); return t * t * (3 - 2 * t); };
  const phase = (time, start, end) => ease((time - start) / (end - start));
  const mix = (a, b, progress) => a + (b - a) * progress;
  const validImage = (value) => typeof value === "string" && value.length <= MAX_IMAGE_LENGTH
    && /^data:image\/(?:png|jpeg|jpg|webp);base64,[a-z\d+/=\s]+$/i.test(value);

  function mount(options = {}) {
    if (active) return active;
    const clearEarlyCover = () => {
      window.__CODEX_DREAM_SKIN_STARTUP_COVER__?.remove?.();
      delete window.__CODEX_DREAM_SKIN_STARTUP_COVER__;
    };
    const done = (reason) => {
      clearEarlyCover();
      return { ready: Promise.resolve(false), finished: Promise.resolve({ reason }), skip() {}, renderAt() {} };
    };
    if (played && options.replay !== true) return done("already-played");
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return done("reduced-motion");
    if (!validImage(options.image) || (options.closedImage && !validImage(options.closedImage))) return done("invalid-image");
    const duration = Math.min(15000, Math.max(1800, Number(options.durationMs) || 12000));
    const title = String(options.title || "Master").slice(0, 40);
    const manual = options.autoplay === false;
    const host = document.createElement("div");
    host.setAttribute("data-dream-startup-intro", "");
    for (const [name, value] of Object.entries({
      all: "initial", position: "fixed", inset: "0", "z-index": "2147483647",
      display: "block", opacity: "1", background: "#050a0f", "pointer-events": "auto", contain: "layout paint style",
    })) host.style.setProperty(name, value, "important");
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = ":host{color-scheme:dark}canvas{display:block;width:100%;height:100%}button{position:absolute;right:28px;top:22px;border:1px solid #d7e2eb40;border-radius:20px;padding:8px 16px;background:#11192080;color:#e1eaf0;font:12px system-ui,sans-serif;letter-spacing:.08em;cursor:pointer;backdrop-filter:blur(12px)}button:hover,button:focus-visible{background:#263643;border-color:#c8d8e4;outline:none}@media(max-width:600px){button{right:14px;top:14px}}";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    const skip = document.createElement("button");
    skip.textContent = "跳过 · ESC";
    skip.type = "button";
    skip.setAttribute("aria-label", "跳过启动动画");
    shadow.append(style, canvas, skip);
    const ctx = canvas.getContext("2d");
    if (!ctx) return done("canvas-unavailable");
    let resolveFinished;
    let resolveReady;
    let settled = false;
    let frameId = 0;
    let deadline = 0;
    let start = null;
    let width = 1;
    let height = 1;
    let ratio = 1;
    let loaded = false;
    const images = [];
    const finished = new Promise((resolve) => { resolveFinished = resolve; });
    const ready = new Promise((resolve) => { resolveReady = resolve; });
    const controller = { ready, finished, skip: () => finish("skipped"), renderAt, version: VERSION };
    active = controller;

    function finish(reason) {
      if (settled) return;
      settled = true;
      cancelAnimationFrame(frameId);
      clearTimeout(deadline);
      window.removeEventListener("resize", resize);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("visibilitychange", visibility);
      host.removeEventListener("click", controller.skip);
      for (const image of images) { image.onload = null; image.onerror = null; }
      host.remove();
      clearEarlyCover();
      if (active === controller) active = null;
      resolveReady(false);
      resolveFinished({ reason });
    }

    function keydown(event) { if (event.key === "Escape") finish("skipped"); }
    function visibility() { if (document.hidden) finish("hidden"); }
    function resize() {
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      ratio = Math.min(window.devicePixelRatio || 1, 2, 3200 / width, 2400 / height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    let seed = 48371;
    function random() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    const stars = Array.from({ length: 150 }, () => ({ x: random(), y: random(), size: random() * 1.4 + .3, delay: random() * 6 }));
    const shards = Array.from({ length: 1100 }, () => ({
      angle: random() * Math.PI * 2, radial: Math.sqrt(random()), speed: .55 + random() * .5,
      size: 1.5 + random() * 8, spin: random() * 8, bright: random(), delay: random() * .12,
    }));

    function spacedText(text, x, y, spacing, font, color) {
      ctx.font = font;
      ctx.fillStyle = color;
      const widths = [...text].map((letter) => ctx.measureText(letter).width);
      let left = x - (widths.reduce((a, b) => a + b, 0) + spacing * (widths.length - 1)) / 2;
      [...text].forEach((letter, i) => { ctx.fillText(letter, left, y); left += widths[i] + spacing; });
    }

    function drawArt(image, zoom, focusX = .5, focusY = .5, alpha = 1) {
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom;
      ctx.globalAlpha = alpha;
      ctx.drawImage(image, width / 2 - image.naturalWidth * focusX * scale,
        height / 2 - image.naturalHeight * focusY * scale,
        image.naturalWidth * scale, image.naturalHeight * scale);
      ctx.globalAlpha = 1;
    }

    function drawEyeGlow(image, zoom, focusX, focusY, intensity) {
      if (intensity <= 0) return;
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom;
      const left = width / 2 - image.naturalWidth * focusX * scale;
      const top = height / 2 - image.naturalHeight * focusY * scale;
      const radius = Math.min(width, height) * .06;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (const [xRatio, yRatio] of [[.665, .307], [.725, .366]]) {
        const x = left + image.naturalWidth * xRatio * scale;
        const y = top + image.naturalHeight * yRatio * scale;
        const halo = ctx.createRadialGradient(x, y, 0, x, y, radius * 1.55);
        halo.addColorStop(0, `rgba(199,230,248,${.3 * intensity})`);
        halo.addColorStop(.4, `rgba(165,211,239,${.14 * intensity})`);
        halo.addColorStop(1, "rgba(150,205,235,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.ellipse(x, y, radius * 1.55, radius * .82, -.06, 0, Math.PI * 2);
        ctx.fill();
        const irisRadius = radius * .62;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, irisRadius);
        glow.addColorStop(0, `rgba(248,253,255,${.88 * intensity})`);
        glow.addColorStop(.38, `rgba(205,234,250,${.48 * intensity})`);
        glow.addColorStop(1, "rgba(150,205,235,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.ellipse(x, y, irisRadius, irisRadius * .62, -.06, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = intensity * .7;
        ctx.shadowColor = "#dff2ff";
        ctx.shadowBlur = 22 * intensity;
        ctx.strokeStyle = "#f8fcff";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x - radius * .27, y);
        ctx.lineTo(x + radius * .27, y);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    }

    function drawPortrait(image, centerX, centerY, radius) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.clip();
      const scale = radius * 2 / (image.naturalWidth * .33);
      ctx.drawImage(image, centerX - image.naturalWidth * .70 * scale,
        centerY - image.naturalHeight * .31 * scale,
        image.naturalWidth * scale, image.naturalHeight * scale);
      const shade = ctx.createLinearGradient(0, centerY - radius, 0, centerY + radius);
      shade.addColorStop(0, "#10182000"); shade.addColorStop(1, "#060b1050");
      ctx.fillStyle = shade;
      ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
      ctx.restore();
    }

    function drawHud(time, image, opacity) {
      const x = width / 2;
      const y = height * .41;
      const radius = Math.min(width * .205, height * .242, 245);
      const appear = phase(time, 0, .55);
      if (opacity <= 0 || appear <= 0) return;
      const scatter = phase(time, 1.65, 2.48);
      const expand = 1 + phase(time, 1.45, 2.35) * .28;
      ctx.save();
      ctx.globalAlpha = opacity * appear;
      const glow = ctx.createRadialGradient(x, y, radius * .5, x, y, radius * 2.8);
      glow.addColorStop(0, "#dce9f01e"); glow.addColorStop(.5, "#8fa7b51a"); glow.addColorStop(1, "#0a121800");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(expand, expand);
      ctx.translate(-x, -y);
      drawPortrait(image, x, y, radius * .89);
      ctx.strokeStyle = "#dce6ed";
      ctx.lineWidth = 1.1;
      for (const size of [.925, 1, 1.095]) {
        ctx.globalAlpha = opacity * appear * (size === 1 ? .75 : .27);
        ctx.beginPath(); ctx.arc(x, y, radius * size, 0, Math.PI * 2); ctx.stroke();
      }
      const rotation = time * .28;
      ctx.lineWidth = 3;
      ctx.globalAlpha = opacity * appear * .85;
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = i === 1 ? "#f1f6f9" : "#91aabe";
        ctx.beginPath(); ctx.arc(x, y, radius * 1.02, rotation + i * Math.PI * .68, rotation + i * Math.PI * .68 + .58); ctx.stroke();
      }
      for (let i = 0; i < 80; i++) {
        const angle = i * Math.PI / 40 - rotation * .38;
        const large = i % 10 === 0;
        ctx.globalAlpha = opacity * appear * (large ? .75 : .28);
        ctx.lineWidth = large ? 1.3 : .7;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * radius * 1.16, y + Math.sin(angle) * radius * 1.16);
        ctx.lineTo(x + Math.cos(angle) * radius * (large ? 1.205 : 1.18), y + Math.sin(angle) * radius * (large ? 1.205 : 1.18));
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = opacity * appear * (1 - scatter);
      const labelY = y + radius * 1.34;
      spacedText("SILVER DRAGON · INITIALIZING", x, labelY, 2.2, "13px system-ui, sans-serif", "#c5d2dc");
      spacedText(title, x, labelY + Math.min(80, height * .092), 3.2, `300 ${Math.min(68, width * .105, height * .081)}px system-ui, sans-serif`, "#f3f7fa");
      const lineY = labelY + Math.min(80, height * .092) + 25;
      ctx.strokeStyle = "#cfdae340"; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(x - 96, lineY); ctx.lineTo(x - 17, lineY); ctx.moveTo(x + 17, lineY); ctx.lineTo(x + 96, lineY); ctx.stroke();
      ctx.fillStyle = "#e3edf4";
      ctx.save(); ctx.translate(x, lineY); ctx.rotate(Math.PI / 4); ctx.fillRect(-2, -2, 4, 4); ctx.restore();
      ctx.globalAlpha = opacity * appear * .38;
      ctx.strokeStyle = "#c7d3dc";
      for (const side of [-1, 1]) {
        const edge = x + side * radius * 1.54;
        ctx.beginPath(); ctx.moveTo(edge - side * 15, y - radius * .47); ctx.lineTo(edge, y - radius * .47);
        ctx.lineTo(edge, y + radius * .47); ctx.lineTo(edge - side * 15, y + radius * .47); ctx.stroke();
      }
      ctx.restore();
    }

    function renderAt(milliseconds) {
      if (!loaded || settled) return false;
      try {
        const time = clamp(Number(milliseconds) / duration) * 12;
        const portraitToCloseup = phase(time, 3.18, 4.05);
        const zoomOut = phase(time, 5.35, 8.7);
        const eyeOpen = phase(time, 4.45, 5.15);
        const eyeGlow = phase(time, 4.28, 4.82) * (1 - phase(time, 5.35, 6.05));
        const fade = phase(time, 10.85, 12);
        host.style.setProperty("opacity", String(1 - fade), "important");
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#050a0f";
        ctx.fillRect(0, 0, width, height);
        const baseGlow = ctx.createRadialGradient(width * .5, height * .4, 0, width * .5, height * .4, Math.max(width, height) * .66);
        baseGlow.addColorStop(0, "#15212a"); baseGlow.addColorStop(1, "#050a0f");
        ctx.fillStyle = baseGlow; ctx.fillRect(0, 0, width, height);
        const open = images[0];
        const closed = images[1] || open;
        const closeOpacity = portraitToCloseup;
        if (closeOpacity > 0) {
          const zoom = mix(3.4, 1, zoomOut);
          const focusX = mix(.70, .5, zoomOut);
          const focusY = mix(.31, .5, zoomOut);
          drawArt(closed, zoom, focusX, focusY, closeOpacity);
          if (eyeOpen > 0) drawArt(open, zoom, focusX, focusY, closeOpacity * eyeOpen);
          drawEyeGlow(open, zoom, focusX, focusY, closeOpacity * eyeGlow);
        }
        ctx.save();
        ctx.globalAlpha = (1 - portraitToCloseup) * .5;
        for (const star of stars) {
          ctx.fillStyle = `rgba(218,231,240,${.22 + .3 * Math.sin(time + star.delay) ** 2})`;
          ctx.beginPath(); ctx.arc(star.x * width, star.y * height, star.size, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        drawHud(time, open, 1 - portraitToCloseup);
        const scatter = phase(time, 1.8, 3.9);
        if (scatter > 0 && scatter < 1) {
          const x = width / 2; const y = height * .41;
          const radius = Math.min(width * .205, height * .242, 245);
          ctx.save();
          for (const shard of shards) {
            const progress = clamp((scatter - shard.delay) / (1 - shard.delay));
            const distance = radius * (.3 + shard.radial * .55) + progress ** 1.15 * Math.max(width, height) * .82 * shard.speed;
            const px = x + Math.cos(shard.angle) * distance;
            const py = y + Math.sin(shard.angle) * distance * .74;
            const size = shard.size * (1 - progress * .68);
            ctx.globalAlpha = Math.min(1, scatter * 5) * (.55 + (1 - progress) * .45);
            ctx.fillStyle = shard.bright > .55 ? "#f0f6fa" : "#90a9ba";
            ctx.save(); ctx.translate(px, py); ctx.rotate(shard.angle + Math.PI / 2 + progress * shard.spin);
            ctx.fillRect(-size / 2, -Math.max(.75, size * .11), size * (1 + progress * 1.8), Math.max(1.5, size * .22));
            ctx.restore();
          }
          ctx.restore();
        }
        if (time > 3.3 && time < 8.7) {
          const amount = (1 - zoomOut) * .26;
          const vignette = ctx.createRadialGradient(width / 2, height / 2, height * .12, width / 2, height / 2, Math.max(width, height) * .7);
          vignette.addColorStop(0, "#080e1300"); vignette.addColorStop(1, `rgba(5,10,15,${amount})`);
          ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
        }
        ctx.globalAlpha = 1;
        return true;
      } catch {
        finish("render-error");
        return false;
      }
    }

    function tick(now) {
      if (settled) return;
      if (start === null) start = now;
      const elapsed = now - start;
      renderAt(elapsed);
      if (elapsed >= duration) finish("completed");
      else if (!settled) frameId = requestAnimationFrame(tick);
    }

    function loadImage(value) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        images.push(image);
        image.onload = () => {
          if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 16384
            || image.naturalHeight > 16384 || image.naturalWidth * image.naturalHeight > 50000000) reject(new Error("invalid-image"));
          else resolve(image);
        };
        image.onerror = () => reject(new Error("image-error"));
        image.src = value;
      });
    }

    window.addEventListener("resize", resize);
    document.addEventListener("keydown", keydown);
    document.addEventListener("visibilitychange", visibility);
    host.addEventListener("click", controller.skip);
    document.documentElement.append(host);
    resize();
    deadline = setTimeout(() => finish(loaded ? "deadline" : "image-timeout"), manual ? 600000 : duration + 3500);
    Promise.all([loadImage(options.image), ...(options.closedImage ? [loadImage(options.closedImage)] : [])])
      .then(() => {
        if (settled) return;
        loaded = true;
        played = true;
        renderAt(0);
        clearEarlyCover();
        resolveReady(!settled);
        if (!manual && !settled) frameId = requestAnimationFrame(tick);
      })
      .catch(() => finish("image-error"));
    return controller;
  }

  window.DreamSkinStartupIntro = { mount, skip: () => active?.skip(), version: VERSION };
})();
