// Register GSAP plugin
gsap.registerPlugin(MotionPathPlugin);

// Elements
const throwBtn = document.getElementById("throwBtn");
const resetBtn = document.getElementById("resetBtn");
const cakeTemplate = document.getElementById("cake");
const targetName = document.getElementById("targetName");
const celebratePanel = document.getElementById("celebratePanel");
const splatCanvas = document.getElementById("splatCanvas");
const trailCanvas = document.getElementById("trailCanvas");
const splatCtx = splatCanvas.getContext("2d");
const trailCtx = trailCanvas.getContext("2d");

// Audio elements (background + sfx)
const bgMusic = document.getElementById("bgMusic");
const sfxClick = document.getElementById("sfxClick");
const sfxPop = document.getElementById("sfxPop");

// Music toggle button
const musicToggle = document.getElementById("musicToggle");

// Memories elements
const memoriesGallery = document.getElementById("memoriesGallery");

// Track whether we've started background music (play once on first user gesture)
let musicStarted = false;

// Play SFX helper that supports overlapping/spam by cloning the element
function playSfx(audioEl, opts = {}) {
  if (!audioEl) return;
  try {
    // cloneNode(true) copies the src and attributes — allows multiple concurrent plays
    const clone = audioEl.cloneNode(true);
    clone.preload = "auto";
    if (typeof opts.volume === "number") clone.volume = opts.volume;
    // Append to DOM briefly to increase chance of playback in some browsers (optional)
    clone.style.display = "none";
    document.body.appendChild(clone);
    // Reset time and play
    clone.currentTime = 0;
    const p = clone.play();
    // Remove clone after it ends (or after a timeout fallback)
    const cleanup = () => {
      try {
        clone.remove();
      } catch (e) {}
    };
    if (p && p.then) {
      p.then(() => {
        clone.addEventListener("ended", cleanup, { once: true });
      }).catch(() => {
        // fallback: schedule removal
        setTimeout(cleanup, 1200);
      });
    } else {
      // old browsers
      setTimeout(cleanup, 1200);
    }
  } catch (e) {
    // final fallback: try to replay original
    try {
      audioEl.currentTime = 0;
      audioEl.play().catch(() => {});
    } catch (err) {}
  }
}

// helper to try to start background music on a user gesture
async function tryStartMusic() {
  if (musicStarted) return;
  if (!bgMusic) return;
  // Use the robust WebAudio background player first (if available)
  try {
    await playBackground();
    musicStarted = true;
    return;
  } catch (e) {
    // fallback to media element play
  }
  // try reload and play to overcome some stale states
  try {
    bgMusic.load();
  } catch (e) {}
  bgMusic.volume = 0.55;
  bgMusic.muted = false;
  bgMusic
    .play()
    .then(() => {
      musicStarted = true;
      // update toggle UI
      if (musicToggle) {
        musicToggle.textContent = "Pause Music";
        musicToggle.setAttribute("aria-pressed", "true");
      }
    })
    .catch((err) => {
      // couldn't autoplay even on gesture — that's okay, user can use the toggle
      console.warn("bgMusic play blocked", err);
    });
}

// START: Robust background music via WebAudio
// WebAudio variables for background music
let bgAudioCtx = null;
let bgBuffer = null;
let bgSourceNode = null;
let bgGainNode = null;
let bgPlayingViaBuffer = false;

// load & decode background music into an AudioBuffer (call early)
async function initBgBuffer() {
  if (bgBuffer || !bgMusic || !bgMusic.src) return;
  try {
    bgAudioCtx = bgAudioCtx || new (window.AudioContext || window.webkitAudioContext)();

    // Build a safe absolute URL and encode it to avoid server redirects / incorrect requests
    const rawSrc = bgMusic.getAttribute("src") || bgMusic.src || "";
    const absolute = new URL(rawSrc, location.href).href;
    const fetchUrl = encodeURI(absolute);

    // fetch the mp3/ogg file bytes (same-origin or CORS-enabled)
    const resp = await fetch(fetchUrl, { cache: "reload" });

    // If server responds with a content-disposition attachment or non-audio type, do not attempt decode
    const contentDisposition = resp.headers.get("content-disposition") || "";
    const contentType = (resp.headers.get("content-type") || "").toLowerCase();

    if (!resp.ok) throw new Error("bg fetch " + resp.status);
    if (contentDisposition.toLowerCase().includes("attachment") || !contentType.startsWith("audio/")) {
      // server forces download or returns non-audio — fallback to media element approach
      console.warn("Server returned non-audio or 'attachment' disposition — will use media element fallback. content-disposition:", contentDisposition, "content-type:", contentType);
      bgBuffer = null;
      return;
    }

    const arr = await resp.arrayBuffer();
    bgBuffer = await bgAudioCtx.decodeAudioData(arr);
    // decoded successfully
  } catch (err) {
    console.warn("initBgBuffer failed, will fallback to media element:", err);
    bgBuffer = null;
  }
}

// start the decoded buffer as a looping background track
function startBgBuffer() {
  if (!bgBuffer) return false;
  if (!bgAudioCtx) bgAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  // ensure context is resumed
  if (bgAudioCtx.state === "suspended") {
    bgAudioCtx.resume().catch(() => {});
  }
  // create nodes
  bgSourceNode = bgAudioCtx.createBufferSource();
  bgSourceNode.buffer = bgBuffer;
  bgSourceNode.loop = true;
  bgGainNode = bgAudioCtx.createGain();
  bgGainNode.gain.value = 0.55;
  bgSourceNode.connect(bgGainNode).connect(bgAudioCtx.destination);
  // start now
  bgSourceNode.start(0);
  bgPlayingViaBuffer = true;
  return true;
}

// stop the buffer playback
function stopBgBuffer() {
  try {
    if (bgSourceNode) {
      bgSourceNode.stop();
      bgSourceNode.disconnect();
      bgSourceNode = null;
    }
  } catch (e) {
    /* ignore */
  }
  bgPlayingViaBuffer = false;
}

// Unified start function: tries WebAudio buffer first, falls back to media element
async function playBackground() {
  // try WebAudio path
  if (!bgBuffer) {
    await initBgBuffer();
  }
  if (bgBuffer) {
    const ok = startBgBuffer();
    if (ok) return;
  }
  // fallback: try media element (requires user gesture)
  try {
    bgMusic.muted = false;
    bgMusic.volume = 0.55;
    await bgMusic.play();
  } catch (err) {
    console.warn("fallback bgMusic.play failed", err);
  }
}

// Unified stop
function stopBackground() {
  if (bgPlayingViaBuffer) {
    stopBgBuffer();
  } else {
    try {
      bgMusic.pause();
    } catch (e) {}
  }
}

// Initialize BG buffer early (pre-decode) to improve responsiveness when user clicks toggle
initBgBuffer().catch(() => {});
// END: Robust background music via WebAudio

// Wire the visible music toggle (user requested visible control)
if (musicToggle) {
  // reflect initial state
  musicToggle.textContent = bgMusic && !bgMusic.paused ? "Pause Music" : "Play Music";
  musicToggle.setAttribute("aria-pressed", bgMusic && !bgMusic.paused ? "true" : "false");

  musicToggle.addEventListener("click", async () => {
    // if background is currently playing via buffer or media element, pause it.
    const currentlyPlaying = bgPlayingViaBuffer || (!bgMusic.paused && !bgMusic.ended && bgMusic.currentTime > 0);
    if (currentlyPlaying) {
      stopBackground();
      musicToggle.textContent = "Play Music";
      musicToggle.setAttribute("aria-pressed", "false");
      return;
    }
    // user gesture: resume any suspended contexts and play
    if (bgAudioCtx && bgAudioCtx.state === "suspended") {
      try {
        await bgAudioCtx.resume();
      } catch (e) {}
    }
    await playBackground();
    musicToggle.textContent = "Pause Music";
    musicToggle.setAttribute("aria-pressed", "true");
  });

  // update toggle text if user pauses/plays via other means
  if (bgMusic) {
    bgMusic.addEventListener("pause", () => {
      musicToggle.textContent = "Play Music";
      musicToggle.setAttribute("aria-pressed", "false");
    });
    bgMusic.addEventListener("play", () => {
      musicToggle.textContent = "Pause Music";
      musicToggle.setAttribute("aria-pressed", "true");
    });
  }
}

// Resize canvases (handle DPR)
function resizeCanvas(canvas, ctx) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
}
function resizeAll() {
  resizeCanvas(splatCanvas, splatCtx);
  resizeCanvas(trailCanvas, trailCtx);
  // fixed spacing: always 40px as requested
  celebratePanel.style.paddingBottom = "40px";
}
window.addEventListener("resize", resizeAll);
resizeAll();

// Basic reveals
gsap.from("#photo", { duration: 1.1, y: 40, opacity: 0, ease: "power3.out" });
gsap.from(".gift-card", { duration: 1.1, y: 40, opacity: 0, delay: 0.1, ease: "power3.out" });
gsap.from(".panel", { duration: 1.1, y: 20, opacity: 0, stagger: 0.08, ease: "power3.out", delay: 0.05 });

gsap.to(cakeTemplate, { y: -10, duration: 2.4, yoyo: true, repeat: -1, ease: "sine.inOut" });
gsap.to(cakeTemplate, { rotationY: 6, rotationX: 4, duration: 3.2, yoyo: true, repeat: -1, ease: "sine.inOut", overwrite: true });

// Utility: center of element in client coords
function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, rect: r };
}

// --------- Splats & trail ----------
function drawBlob(ctx, cx, cy, radius, spikes, rotation, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  const step = (Math.PI * 2) / spikes;
  for (let i = 0; i < spikes; i++) {
    const angle = i * step + rotation;
    const r1 = radius * (0.4 + Math.random() * 0.6);
    const r2 = radius * (0.7 + Math.random() * 0.6);
    const x1 = cx + Math.cos(angle) * r1;
    const y1 = cy + Math.sin(angle) * r1;
    const x2 = cx + Math.cos(angle + step * 0.5) * r2;
    const y2 = cy + Math.sin(angle + step * 0.5) * r2;
    if (i === 0) ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(x2, y2, x1, y1);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSplats(clientX, clientY, options = {}) {
  options = Object.assign({ count: 8, maxRadius: 90, palette: ["#ff7aa2", "#ffd166", "#7afcff", "#a3ffa6", "#ffd1ff"] }, options);
  for (let i = 0; i < options.count; i++) {
    const color = options.palette[Math.floor(Math.random() * options.palette.length)];
    const r = Math.random() * options.maxRadius * 0.8 + 12;
    const spikes = Math.floor(Math.random() * 6) + 3;
    const rot = Math.random() * Math.PI * 2;
    drawBlob(splatCtx, clientX + (Math.random() * 160 - 80), clientY + (Math.random() * 80 - 40), r, spikes, rot, color, Math.random() * 0.55 + 0.45);
  }
}

function spawnDomSplats(clientX, clientY) {
  const colors = ["#ff7aa2", "#ffd166", "#7afcff", "#a3ffa6", "#ffd1ff", "#ffd7e0"];
  for (let i = 0; i < 10; i++) {
    const s = document.createElement("div");
    s.className = "splat";
    const size = 18 + Math.random() * 70;
    s.style.width = size + "px";
    s.style.height = size * 0.6 + "px";
    s.style.left = clientX + (Math.random() * 140 - 70) + "px";
    s.style.top = clientY + (Math.random() * 80 - 40) + "px";
    s.style.borderRadius = 30 + Math.random() * 60 + "%";
    s.style.background = colors[Math.floor(Math.random() * colors.length)];
    s.style.opacity = 0.95;
    s.style.transform = `rotate(${Math.random() * 360}deg) scale(${0.4 + Math.random() * 1.1})`;
    s.style.filter = "blur(" + Math.random() * 1.2 + "px)";
    document.body.appendChild(s);
    gsap.fromTo(
      s,
      { scale: 0.2, y: -12, opacity: 0 },
      {
        duration: 0.9 + Math.random() * 0.8,
        scale: 1,
        y: 6 + Math.random() * 30,
        opacity: 0.95,
        ease: "back.out(1.4)",
        onComplete: () => {
          gsap.to(s, { delay: 1.2 + Math.random() * 0.6, opacity: 0, scale: 1.2, duration: 0.9, onComplete: () => s.remove() });
        },
      }
    );
  }
  for (let i = 0; i < 16; i++) {
    const c = document.createElement("div");
    c.className = "confetti";
    c.style.left = clientX + (Math.random() * 200 - 100) + "px";
    c.style.top = clientY + (Math.random() * 100 - 50) + "px";
    c.style.width = 6 + Math.random() * 12 + "px";
    c.style.height = 10 + Math.random() * 20 + "px";
    c.style.background = colors[Math.floor(Math.random() * colors.length)];
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(c);
    gsap.to(c, { duration: 1.6 + Math.random() * 1.4, y: 220 + Math.random() * 600, x: Math.random() * 400 - 200, rotation: Math.random() * 1080 - 540, ease: "power2.in", opacity: 0, onComplete: () => c.remove() });
  }
}

function attachStickerToTarget() {
  const existing = targetName.querySelector(".mini-sticker");
  if (existing) existing.remove();
  const sticker = document.createElement("div");
  sticker.className = "mini-sticker";
  sticker.innerHTML = '<div class="mini-cake" aria-hidden="true"></div>';
  targetName.appendChild(sticker);
  gsap.fromTo(sticker, { scale: 0, rotation: -30, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.45, ease: "back.out(1.4)" });
  gsap.to(sticker, { rotation: 6, duration: 0.22, yoyo: true, repeat: 3, ease: "sine.inOut", delay: 0.2 });
  gsap.to(sticker, { delay: 3.2, duration: 0.9, y: -40, x: 40, rotation: 30, opacity: 0, ease: "power2.in", onComplete: () => sticker.remove() });
}

function onCakeImpact(clientX, clientY) {
  drawSplats(clientX, clientY, { count: 9 + Math.floor(Math.random() * 7), maxRadius: 110 });
  spawnDomSplats(clientX, clientY);

  // play impact pop sound (overlapping supported)
  playSfx(sfxPop, { volume: 0.9 });

  // add glowing class to the target name for a pulse effect
  targetName.classList.add("glow");
  // remove it after animation completes
  setTimeout(() => {
    targetName.classList.remove("glow");
  }, 1200);

  gsap.fromTo(
    targetName,
    { y: 0, rotation: 0 },
    {
      duration: 0.9,
      y: -6,
      rotation: 2,
      ease: "elastic.out(1,0.6)",
      onComplete() {
        gsap.to(targetName, { duration: 0.45, rotation: 0, y: 0 });
      },
    }
  );
  gsap.fromTo("#subtitle", { scale: 1, opacity: 1 }, { duration: 0.6, scale: 1.02, opacity: 0.95, yoyo: true, repeat: 1, ease: "power1.out" });
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.left = 0;
  overlay.style.top = 0;
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.zIndex = 285;
  overlay.style.pointerEvents = "none";
  overlay.style.background = "radial-gradient(circle at " + (clientX / window.innerWidth) * 100 + "% " + (clientY / window.innerHeight) * 100 + "%, rgba(255,250,240,0.12), rgba(0,0,0,0))";
  document.body.appendChild(overlay);
  gsap.to(overlay, { opacity: 0, duration: 1.2, ease: "power2.out", onComplete: () => overlay.remove() });

  attachStickerToTarget();
}

// --------- Throwing logic (clones fixed positioned) ----------
const activeCakes = [];
const maxActive = 8;
let trailPoints = [],
  maxTrailPoints = 140;

function pushTrail(x, y) {
  trailPoints.push({ x, y, life: 1 });
  if (trailPoints.length > maxTrailPoints) trailPoints.splice(0, trailPoints.length - maxTrailPoints);
}

function drawTrail() {
  trailCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  for (let i = 0; i < trailPoints.length; i++) {
    const p = trailPoints[i];
    trailCtx.globalAlpha = Math.max(0, p.life * 0.9);
    const size = 4 + (1 - p.life) * 8;
    trailCtx.fillStyle = `rgba(255,197,235,${0.5 * p.life})`;
    trailCtx.beginPath();
    trailCtx.arc(p.x, p.y, size, 0, Math.PI * 2);
    trailCtx.fill();
  }
  for (let p of trailPoints) p.life -= 0.018;
  if (trailPoints.length && trailPoints[0].life <= 0) trailPoints.shift();
  requestAnimationFrame(drawTrail);
}
requestAnimationFrame(drawTrail);

function throwCake() {
  if (activeCakes.length >= maxActive) {
    gsap.fromTo(throwBtn, { scale: 1 }, { scale: 0.96, duration: 0.08, yoyo: true, repeat: 1 });
    return;
  }

  // play pickup/click sound (overlapping supported) and start music on first user interaction
  playSfx(sfxClick, { volume: 0.9 });
  tryStartMusic();

  // clone
  const cake = cakeTemplate.cloneNode(true);
  cake.style.position = "fixed";
  cake.style.pointerEvents = "none";
  cake.style.left = "0px";
  cake.style.top = "0px";
  cake.style.zIndex = 300;
  document.body.appendChild(cake);
  activeCakes.push(cake);

  const srcRect = cakeTemplate.getBoundingClientRect();
  const start = { x: srcRect.left + srcRect.width / 2, y: srcRect.top + srcRect.height / 2 };
  gsap.set(cake, { x: start.x, y: start.y, xPercent: -50, yPercent: -50, transformOrigin: "50% 50%" });
  const t = centerOf(targetName);
  const end = { x: t.clientX + (Math.random() * 36 - 18), y: t.clientY + (Math.random() * 26 - 12) };
  const midX = (start.x + end.x) / 2 + (Math.random() * 220 - 110);
  const midY = Math.min(start.y, end.y) - (120 + Math.random() * 180);
  const duration = 0.95 + Math.random() * 0.5;
  const getTranslate = gsap.getProperty(cake);

  gsap.to(cake, {
    duration,
    ease: "power2.in",
    motionPath: {
      path: [
        { x: start.x, y: start.y },
        { x: midX, y: midY },
        { x: end.x, y: end.y },
      ],
      curviness: 1.2,
      autoRotate: false,
      align: false,
    },
    onStart() {
      gsap.fromTo(cake, { scale: 0.72, opacity: 0.98 }, { duration: 0.26, scale: 1, opacity: 1, ease: "back.out(1.2)" });
    },
    onUpdate() {
      const x = parseFloat(getTranslate("x")),
        y = parseFloat(getTranslate("y"));
      pushTrail(x, y);
    },
    onComplete() {
      const x = end.x,
        y = end.y;
      gsap.to(cake, { scale: 1.04, rotation: -10, duration: 0.12, yoyo: true, repeat: 1, ease: "power1.out" });
      onCakeImpact(x, y);
      gsap.to(cake, {
        opacity: 0,
        duration: 0.9,
        delay: 0.6,
        onComplete: () => {
          cake.remove();
          const idx = activeCakes.indexOf(cake);
          if (idx !== -1) activeCakes.splice(idx, 1);
        },
      });
    },
  });
  gsap.to(cake, { duration: duration, rotationY: 360 * (Math.random() > 0.5 ? 1 : -1), rotationX: Math.random() * 30 - 12, ease: "none" });
}

// reset splats — animate out instead of immediate clear
function clearSplatScreen() {
  // animate DOM splats and confetti (staggered)
  const domEls = Array.from(document.querySelectorAll(".splat, .confetti"));
  if (domEls.length) {
    domEls.forEach((el, i) => {
      gsap.to(el, {
        duration: 0.48,
        opacity: 0,
        scale: 0.6,
        y: -30,
        rotation: Math.random() * 120 - 60,
        ease: "power2.in",
        delay: i * 0.02,
        onComplete: () => el.remove(),
      });
    });
  }
  // fade out canvases, then clear, then fade them back in
  gsap.to([splatCanvas, trailCanvas], {
    duration: 0.5,
    opacity: 0,
    ease: "power2.in",
    onComplete() {
      // clear drawing buffers
      splatCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      trailCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      trailPoints = [];
      // fade back in quickly to be ready for more drawing
      gsap.to([splatCanvas, trailCanvas], { duration: 0.35, opacity: 1, ease: "power2.out", delay: 0.06 });
    },
  });
}

// Button handlers
throwBtn.addEventListener("click", () => {
  throwCake();
  if (navigator.vibrate) navigator.vibrate(30);
});
resetBtn.addEventListener("click", clearSplatScreen);
throwBtn.addEventListener("keyup", (e) => {
  if (e.key === "Enter" || e.key === " ") throwCake();
});

// click on name throws a cake too
targetName.addEventListener("click", () => {
  throwCake();
  gsap.to(targetName, { scale: 1.03, duration: 0.12, yoyo: true, repeat: 1, ease: "power1.out" });
});

// intersection reveal for panels
const panels = document.querySelectorAll(".panel");
const obs = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        gsap.to(entry.target, { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" });
        obs.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.16 }
);
panels.forEach((p) => {
  gsap.set(p, { opacity: 0, y: 14 });
  obs.observe(p);
});

// initial burst
window.addEventListener("load", () => {
  const t = centerOf(targetName);
  setTimeout(() => {
    drawSplats(t.clientX, t.clientY, { count: 6, maxRadius: 60 });
    spawnDomSplats(t.clientX, t.clientY);
  }, 900);
  // ensure fixed padding is present after load
  celebratePanel.style.paddingBottom = "40px";
});

// DPR watcher
let lastDpr = window.devicePixelRatio;
const dprWatcher = setInterval(() => {
  if (window.devicePixelRatio !== lastDpr) {
    lastDpr = window.devicePixelRatio;
    resizeAll();
  }
}, 800);
window.addEventListener("beforeunload", () => clearInterval(dprWatcher));

// ---------- REFINED CENTERED LIGHTBOX BEHAVIOR (REPLACES previous lightbox wiring) ----------
(function initLightbox() {
  const lightboxEl = document.getElementById("lightbox");
  const inner = lightboxEl.querySelector(".lightbox-inner");
  const mediaImg = document.getElementById("lightboxImg");
  const captionEl = document.getElementById("lbCaption");
  const btnClose = document.getElementById("lbClose");
  const btnCloseFooter = document.getElementById("lbCloseBtn");
  const btnPrev = document.querySelector(".lb-prev");
  const btnNext = document.querySelector(".lb-next");
  const btnPrevFooter = document.getElementById("lbPrevBtn");
  const btnNextFooter = document.getElementById("lbNextBtn");

  // gather sources + captions
  const thumbs = Array.from(document.querySelectorAll("#memoriesGallery .thumb img"));
  const captions = Array.from(document.querySelectorAll("#memoriesGallery .caption")).map((c) => c.textContent || "");
  const sources = thumbs.map((t) => t.src);

  let currentIndex = 0;
  let lastFocused = null;

  function show(index) {
    if (index < 0) index = sources.length - 1;
    if (index >= sources.length) index = 0;
    currentIndex = index;
    mediaImg.src = sources[currentIndex];
    mediaImg.alt = captions[currentIndex] || "Photo";
    captionEl.textContent = captions[currentIndex] || "";
    lightboxEl.classList.add("open");
    inner.setAttribute("aria-hidden", "false");
    lightboxEl.setAttribute("aria-hidden", "false");

    // small entrance animation via GSAP (subtle)
    gsap.fromTo(inner, { opacity: 0, scale: 0.985, y: 8 }, { duration: 0.28, opacity: 1, scale: 1, y: 0, ease: "power2.out" });

    // accessibility: trap focus
    lastFocused = document.activeElement;
    btnClose.focus();
    document.addEventListener("focus", trapFocus, true);
  }

  function hide() {
    lightboxEl.classList.remove("open");
    inner.setAttribute("aria-hidden", "true");
    lightboxEl.setAttribute("aria-hidden", "true");
    mediaImg.src = "";
    captionEl.textContent = "";
    document.removeEventListener("focus", trapFocus, true);
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  }

  function prev() {
    show((currentIndex - 1 + sources.length) % sources.length);
  }
  function next() {
    show((currentIndex + 1) % sources.length);
  }

  // keyboard navigation
  function onKey(e) {
    if (lightboxEl.classList.contains("open")) {
      if (e.key === "Escape") {
        e.preventDefault();
        hide();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
    }
  }
  document.addEventListener("keydown", onKey);

  // trap tab focus inside the lightbox when open
  function trapFocus(e) {
    if (!lightboxEl.classList.contains("open")) return;
    if (!inner.contains(e.target)) {
      e.stopPropagation();
      btnClose.focus();
    }
  }

  // click handlers
  btnClose.addEventListener("click", hide);
  btnCloseFooter && btnCloseFooter.addEventListener("click", hide);
  btnPrev && btnPrev.addEventListener("click", prev);
  btnNext && btnNext.addEventListener("click", next);
  btnPrevFooter && btnPrevFooter.addEventListener("click", prev);
  btnNextFooter && btnNextFooter.addEventListener("click", next);

  // clicking outside inner closes
  lightboxEl.addEventListener("click", (e) => {
    if (e.target === lightboxEl) hide();
  });

  // swipe support (basic)
  let touchStartX = 0;
  let touchStartY = 0;
  let touchMoved = false;
  inner.addEventListener("touchstart", (ev) => {
    if (!ev.touches || !ev.touches[0]) return;
    touchStartX = ev.touches[0].clientX;
    touchStartY = ev.touches[0].clientY;
    touchMoved = false;
  });
  inner.addEventListener("touchmove", (ev) => {
    touchMoved = true;
  });
  inner.addEventListener("touchend", (ev) => {
    if (!touchMoved || !ev.changedTouches || !ev.changedTouches[0]) return;
    const dx = ev.changedTouches[0].clientX - touchStartX;
    const dy = ev.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) prev();
      else next();
    }
  });

  // wire thumbnails to open refined lightbox
  thumbs.forEach((img, i) => {
    img.style.cursor = "zoom-in";
    img.addEventListener("click", () => {
      show(i);
    });
    // allow keyboard activation
    img.setAttribute("tabindex", "0");
    img.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        show(i);
      }
    });
  });

  // expose for debugging if needed
  window.__refinedLightbox = { show, hide, next, prev };
})();
// ---------- end refined lightbox ----------
