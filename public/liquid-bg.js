/* ============================================================================
 * Liquid emerald background — animated, GPU-friendly, dependency-free.
 * ----------------------------------------------------------------------------
 * Paints several large, soft radial-gradient "blobs" in emerald/lime/forest
 * greens onto a small (reduced-resolution) canvas using additive blending, then
 * a CSS blur (set here) fuses them into flowing, viscous "molten glass" motion.
 *
 * Performance strategy:
 *   • Render at a fraction of screen resolution — the canvas is blurred and
 *     upscaled, so the eye can't tell, but we draw far fewer pixels.
 *   • Adaptive quality tiers chosen from device signals (mobile / cores / RAM),
 *     plus a live FPS watchdog that steps quality DOWN if frames drop.
 *   • Pause the rAF loop when the tab is hidden (no wasted work, no leaks).
 *   • Respect prefers-reduced-motion with a single static frame.
 * ========================================================================== */
(function () {
  "use strict";

  var canvas = document.getElementById("liquid-canvas");
  if (!canvas) return;
  // alpha:true lets the CSS fallback gradient show through faint areas.
  var ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return; // very old browser → CSS static gradient remains as backdrop

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // --- Palette: low-blue greens so additive overlaps trend lime, not white ---
  var COLORS = [
    [16, 185, 129], // emerald
    [132, 204, 22], // lime
    [21, 128, 61],  // forest
    [5, 150, 105],  // deep emerald
    [163, 230, 53], // bright lime accent
  ];

  // --- Adaptive quality: pick a starting tier from device capability ---------
  function pickTier() {
    var mobile = window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
    var cores = navigator.hardwareConcurrency || 4;
    var mem = navigator.deviceMemory || 4;
    if (mobile || cores <= 4 || mem <= 4) {
      return { blobs: 5, scale: 0.4, blur: 42 }; // lighter — mobile / low-power
    }
    return { blobs: 7, scale: 0.5, blur: 55 };   // full — capable desktop
  }
  var tier = pickTier();

  // Step-down ladder used by the FPS watchdog: each level is cheaper than the
  // last (fewer blobs, smaller canvas, less blur).
  var QUALITY = [
    { blobs: tier.blobs, scale: tier.scale, blur: tier.blur },
    { blobs: Math.max(4, tier.blobs - 2), scale: tier.scale * 0.82, blur: tier.blur * 0.9 },
    { blobs: 3, scale: 0.3, blur: 32 },
  ];
  var qi = 0; // current quality index

  var W = 0, H = 0, blobs = [];
  var rafId = null, running = false;
  var frames = 0, fpsClock = 0; // FPS sampling

  function rand(a, b) { return a + Math.random() * (b - a); }

  // Blob descriptors. Motion is a sum of sine/cosine terms → organic drift that
  // is continuous (never jumps) and therefore loops seamlessly forever.
  function makeBlobs(n) {
    var arr = [];
    for (var i = 0; i < n; i++) {
      arr.push({
        c: COLORS[i % COLORS.length],
        bx: rand(0.12, 0.88), by: rand(0.12, 0.88), // base position (fractions)
        ax: rand(0.08, 0.22), ay: rand(0.08, 0.22), // drift amplitude
        fx: rand(0.04, 0.10), fy: rand(0.04, 0.10), // drift speed (rad/s)
        px: rand(0, 6.2832), py: rand(0, 6.2832),   // phase offset
        r: rand(0.34, 0.58),                         // radius (fraction of min dim)
        a: rand(0.5, 0.8),                           // core alpha
      });
    }
    return arr;
  }

  // (Re)size the canvas for the current quality tier and viewport, then rebuild
  // blobs and the blur amount. Called on init, resize, and quality change.
  function applyQuality() {
    var q = QUALITY[qi];
    W = Math.max(1, Math.round(window.innerWidth * q.scale));
    H = Math.max(1, Math.round(window.innerHeight * q.scale));
    canvas.width = W;
    canvas.height = H;
    canvas.style.filter = "blur(" + q.blur + "px)";
    blobs = makeBlobs(q.blobs);
  }

  // Draw one frame at time t (seconds).
  function draw(t) {
    // Dark forest base wash.
    ctx.globalCompositeOperation = "source-over";
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#041a10");
    g.addColorStop(1, "#03110a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Additive blobs → glowing, blending liquid.
    ctx.globalCompositeOperation = "lighter";
    var minDim = Math.min(W, H);
    for (var i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      var x = (b.bx + Math.sin(t * b.fx + b.px) * b.ax) * W;
      var y = (b.by + Math.cos(t * b.fy + b.py) * b.ay) * H;
      var r = b.r * minDim;
      var rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      var c = b.c;
      rg.addColorStop(0, "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + b.a + ")");
      rg.addColorStop(1, "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0)");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.fill();
    }
  }

  // Main animation loop (time-based, so speed is frame-rate independent).
  function loop(now) {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    draw(now * 0.001); // ms → s; slow, calm motion

    // FPS watchdog: sample ~every 2s and step quality down if we're struggling.
    frames++;
    if (!fpsClock) fpsClock = now;
    if (now - fpsClock >= 2000) {
      var fps = (frames * 1000) / (now - fpsClock);
      frames = 0;
      fpsClock = now;
      if (fps < 42 && qi < QUALITY.length - 1) {
        qi++;
        applyQuality();
      }
    }
  }

  function start() {
    if (running) return;
    running = true;
    frames = 0;
    fpsClock = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function staticFrame() {
    applyQuality();
    draw(1.2); // arbitrary pleasing still frame
  }

  // Debounced resize so rapid drags don't thrash the canvas allocation.
  var resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      applyQuality();
      if (!running) draw(1.2); // keep the static frame correct when paused
    }, 200);
  }

  // Pause when hidden (saves battery, avoids background work / leaks).
  function onVisibility() {
    if (document.hidden) stop();
    else if (!reduceMotion.matches) start();
  }

  // React to the user toggling reduced-motion at runtime.
  function onMotionPref() {
    if (reduceMotion.matches) {
      stop();
      staticFrame();
    } else {
      start();
    }
  }

  function init() {
    applyQuality();
    if (reduceMotion.matches) staticFrame();
    else start();

    window.addEventListener("resize", onResize, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    if (reduceMotion.addEventListener) {
      reduceMotion.addEventListener("change", onMotionPref);
    } else if (reduceMotion.addListener) {
      reduceMotion.addListener(onMotionPref); // Safari < 14 fallback
    }
    // Teardown safety (bfcache / navigation) — cancel the rAF loop and any
    // pending debounced resize so nothing dangles.
    window.addEventListener("pagehide", function () {
      stop();
      clearTimeout(resizeTimer);
    });
  }

  init();
})();
