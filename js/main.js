/* ═══════════════════════════════════════════════════════════════
   presca.life — main.js
   Three.js sky (clouds → stars) + GSAP choreography + play
   ═══════════════════════════════════════════════════════════════ */

import * as THREE from "three";

gsap.registerPlugin(ScrollTrigger);

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isTouch = window.matchMedia("(pointer: coarse)").matches;
const mouse = { x: 0.5, y: 0.5 }; // normalized 0..1

/* ─────────────────────────────────────────────────────────────
   1 · THE SKY — one WebGL scene, clouds by day, stars by night
   ───────────────────────────────────────────────────────────── */

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const sceneGL = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.z = 10;

/* soft cloud texture painted on a canvas — no image assets needed */
function makeCloudTexture() {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const blobs = 14;
  for (let i = 0; i < blobs; i++) {
    const x = size / 2 + (Math.random() - 0.5) * size * 0.5;
    const y = size / 2 + (Math.random() - 0.5) * size * 0.32;
    const r = size * (0.12 + Math.random() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.16)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

/* round star sprite texture */
function makeStarTexture() {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,250,230,1)");
  g.addColorStop(0.35, "rgba(255,244,205,0.65)");
  g.addColorStop(1, "rgba(255,244,205,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

/* clouds: a drifting flock of soft sprites */
const cloudGroup = new THREE.Group();
const cloudCount = isTouch ? 10 : 18;
const cloudTexPool = [makeCloudTexture(), makeCloudTexture(), makeCloudTexture()];
const clouds = [];
for (let i = 0; i < cloudCount; i++) {
  const mat = new THREE.SpriteMaterial({
    map: cloudTexPool[i % cloudTexPool.length],
    transparent: true,
    opacity: 0.55 + Math.random() * 0.35,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  const scale = 4 + Math.random() * 7;
  sprite.scale.set(scale * 1.5, scale, 1);
  sprite.position.set(
    (Math.random() - 0.5) * 26,
    (Math.random() - 0.5) * 12,
    (Math.random() - 0.5) * 6
  );
  sprite.userData.speed = 0.0015 + Math.random() * 0.0035;
  sprite.userData.bobPhase = Math.random() * Math.PI * 2;
  sprite.userData.bobAmp = 0.15 + Math.random() * 0.3;
  sprite.userData.baseY = sprite.position.y;
  cloudGroup.add(sprite);
  clouds.push(sprite);
}
sceneGL.add(cloudGroup);

/* stars: two point clouds that twinkle out of phase */
const starGroup = new THREE.Group();
const starTex = makeStarTexture();
function makeStarField(count, size) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 34;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 20;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 8;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    map: starTex,
    size,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  starGroup.add(points);
  return mat;
}
const starMatA = makeStarField(isTouch ? 140 : 320, 0.16);
const starMatB = makeStarField(isTouch ? 90 : 200, 0.26);
sceneGL.add(starGroup);

/* scroll-driven state: 0 = day (clouds), 1 = night (stars) */
const skyState = { night: 0 };

let rafPaused = false;
const clock = new THREE.Clock();

function renderSky() {
  const t = clock.getElapsedTime();

  if (!prefersReducedMotion) {
    for (const cl of clouds) {
      cl.position.x += cl.userData.speed;
      if (cl.position.x > 16) cl.position.x = -16;
      cl.position.y = cl.userData.baseY + Math.sin(t * 0.4 + cl.userData.bobPhase) * cl.userData.bobAmp;
    }
    starGroup.rotation.z = t * 0.004;
    const nightAmt = skyState.night;
    starMatA.opacity = nightAmt * (0.55 + Math.sin(t * 1.7) * 0.3);
    starMatB.opacity = nightAmt * (0.7 + Math.sin(t * 1.1 + 2) * 0.25);
  } else {
    starMatA.opacity = skyState.night * 0.7;
    starMatB.opacity = skyState.night * 0.8;
  }

  cloudGroup.visible = skyState.night < 0.98;
  starGroup.visible = skyState.night > 0.02;
  clouds.forEach((cl) => {
    cl.material.opacity = Math.min(cl.material.userData?.base ?? 0.7, 1) * (1 - skyState.night);
  });

  /* gentle parallax toward the cursor */
  if (!prefersReducedMotion && !isTouch) {
    camera.position.x += ((mouse.x - 0.5) * 1.6 - camera.position.x) * 0.03;
    camera.position.y += ((0.5 - mouse.y) * 1.0 - camera.position.y) * 0.03;
  }

  renderer.render(sceneGL, camera);
  if (!rafPaused) requestAnimationFrame(renderSky);
}
clouds.forEach((cl) => (cl.material.userData = { base: cl.material.opacity }));
requestAnimationFrame(renderSky);

document.addEventListener("visibilitychange", () => {
  rafPaused = document.hidden;
  if (!rafPaused) requestAnimationFrame(renderSky);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener("pointermove", (e) => {
  mouse.x = e.clientX / window.innerWidth;
  mouse.y = e.clientY / window.innerHeight;
});

/* ─────────────────────────────────────────────────────────────
   2 · DAY → NIGHT — sky colors tween as you scroll
   ───────────────────────────────────────────────────────────── */

const root = document.documentElement;
const skyStops = [
  { at: "#hero",    top: "#a9d7f2", bottom: "#eef8fd", night: 0 },   // morning
  { at: "#observe", top: "#b8def4", bottom: "#f3fafd", night: 0 },   // noon
  { at: "#journey", top: "#aacdf0", bottom: "#fdeee0", night: 0 },   // afternoon
  { at: "#craft",   top: "#d9b8dc", bottom: "#ffd9c7", night: 0.1 }, // dusk
  { at: "#work",    top: "#232a52", bottom: "#10142e", night: 1 },   // night
  { at: "#contact", top: "#0b0f26", bottom: "#05070f", night: 1 },   // deep night
];

skyStops.forEach((stop, i) => {
  if (i === 0) return;
  const prev = skyStops[i - 1];
  const proxy = { t: 0 };
  const cTop = gsap.utils.interpolate(prev.top, stop.top);
  const cBottom = gsap.utils.interpolate(prev.bottom, stop.bottom);
  const cNight = gsap.utils.interpolate(prev.night, stop.night);
  ScrollTrigger.create({
    trigger: stop.at,
    start: "top 95%",
    end: "top 25%",
    scrub: 0.6,
    onUpdate(self) {
      proxy.t = self.progress;
      root.style.setProperty("--sky-top", cTop(proxy.t));
      root.style.setProperty("--sky-bottom", cBottom(proxy.t));
      skyState.night = cNight(proxy.t);
    },
  });
});

/* flip nav to moonlight when night falls */
ScrollTrigger.create({
  trigger: "#work",
  start: "top 60%",
  onEnter: () => document.body.classList.add("is-night"),
  onLeaveBack: () => document.body.classList.remove("is-night"),
});

/* ─────────────────────────────────────────────────────────────
   3 · TEXT — split words, reveal on scroll
   ───────────────────────────────────────────────────────────── */

document.querySelectorAll(".split-words").forEach((el) => {
  const nodes = [...el.childNodes];
  el.textContent = "";
  nodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      node.textContent.split(/(\s+)/).forEach((piece) => {
        if (!piece) return;
        if (/^\s+$/.test(piece)) {
          el.appendChild(document.createTextNode(" "));
        } else {
          const w = document.createElement("span");
          w.className = "word";
          const inner = document.createElement("span");
          inner.textContent = piece;
          w.appendChild(inner);
          el.appendChild(w);
        }
      });
    } else {
      el.appendChild(node); // keep <br>, .wonder spans, etc. intact
    }
  });
});

if (!prefersReducedMotion) {
  document.querySelectorAll(".split-words").forEach((el) => {
    gsap.to(el.querySelectorAll(".word > span"), {
      y: 0,
      duration: 0.9,
      ease: "power3.out",
      stagger: 0.035,
      scrollTrigger: { trigger: el, start: "top 85%" },
    });
  });
} else {
  document.querySelectorAll(".split-words .word > span").forEach((s) => (s.style.transform = "none"));
}

/* generic card reveals */
function revealUp(selector, opts = {}) {
  document.querySelectorAll(selector).forEach((el, i) => {
    gsap.from(el, {
      y: prefersReducedMotion ? 0 : 50,
      opacity: 0,
      duration: 1,
      ease: "power3.out",
      delay: (opts.stagger ?? 0) * (i % (opts.mod ?? 99)),
      scrollTrigger: { trigger: el, start: "top 88%" },
    });
  });
}
revealUp(".observe__card", { stagger: 0.12, mod: 3 });
revealUp(".journey__card");
revealUp(".project", { stagger: 0.1, mod: 2 });
revealUp(".craft__flow");
revealUp(".contact__cta");

/* ─────────────────────────────────────────────────────────────
   4 · HERO — letters rise, roles rotate, clouds on click
   ───────────────────────────────────────────────────────────── */

const loader = document.getElementById("loader");
window.addEventListener("load", () => {
  setTimeout(() => {
    loader.classList.add("is-done");
    if (!prefersReducedMotion) {
      gsap.from(".hero__letter", {
        y: 90,
        opacity: 0,
        rotate: 6,
        duration: 1.1,
        ease: "power4.out",
        stagger: 0.07,
      });
      gsap.from(".reveal-line, .hero__roles", {
        y: 24,
        opacity: 0,
        duration: 0.9,
        ease: "power3.out",
        stagger: 0.12,
        delay: 0.45,
      });
    }
  }, 500);
});

/* rotating roles */
const roles = [
  "product designer",
  "AI-native builder",
  "UX designer at heart",
  "solopreneur",
  "observer of little things",
  "creative thinker",
];
const roleEl = document.getElementById("roleRotator");
let roleIdx = 0;
function nextRole() {
  roleIdx = (roleIdx + 1) % roles.length;
  if (prefersReducedMotion) {
    roleEl.textContent = roles[roleIdx];
    return;
  }
  gsap.to(roleEl, {
    y: -14,
    opacity: 0,
    duration: 0.4,
    ease: "power2.in",
    onComplete() {
      roleEl.textContent = roles[roleIdx];
      gsap.fromTo(roleEl, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power2.out" });
    },
  });
}
setInterval(nextRole, 2800);

/* click the sky → a cloud puff drifts away */
document.getElementById("hero").addEventListener("pointerdown", (e) => {
  if (e.target.closest("a, button, .wonder")) return;
  const puff = document.createElement("div");
  puff.className = "puff";
  const size = 60 + Math.random() * 90;
  puff.style.width = puff.style.height = `${size}px`;
  puff.style.left = `${e.clientX - size / 2}px`;
  puff.style.top = `${e.clientY - size / 2}px`;
  document.body.appendChild(puff);
  gsap.fromTo(
    puff,
    { scale: 0.2, opacity: 0 },
    {
      scale: 1,
      opacity: 0.9,
      duration: 0.5,
      ease: "power2.out",
      onComplete() {
        gsap.to(puff, {
          x: (Math.random() - 0.3) * 220,
          y: -120 - Math.random() * 120,
          scale: 1.6,
          opacity: 0,
          duration: 2.6,
          ease: "power1.out",
          onComplete: () => puff.remove(),
        });
      },
    }
  );
  chime(392 + Math.random() * 200); // a soft note, if sound is on
});

/* ─────────────────────────────────────────────────────────────
   5 · THE EYE — it watches, it blinks
   ───────────────────────────────────────────────────────────── */

const eye = document.getElementById("eye");
const iris = document.getElementById("iris");
const pupil = document.getElementById("pupil");
const glint = document.getElementById("glint");

if (!isTouch && !prefersReducedMotion) {
  window.addEventListener("pointermove", (e) => {
    const r = eye.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = (e.clientX - cx) / window.innerWidth;
    const dy = (e.clientY - cy) / window.innerHeight;
    const mx = gsap.utils.clamp(-26, 26, dx * 90);
    const my = gsap.utils.clamp(-14, 14, dy * 60);
    gsap.to([iris, pupil], { x: mx, y: my, duration: 0.5, ease: "power2.out" });
    gsap.to(glint, { x: mx * 0.85, y: my * 0.85, duration: 0.5, ease: "power2.out" });
  });
}
/* occasional blink */
setInterval(() => {
  if (Math.random() < 0.55) {
    eye.classList.add("is-blinking");
    setTimeout(() => eye.classList.remove("is-blinking"), 320);
  }
}, 3200);

/* ─────────────────────────────────────────────────────────────
   6 · THE RIVER — draws itself as you scroll
   ───────────────────────────────────────────────────────────── */

["riverPath", "riverShimmer"].forEach((id, i) => {
  const path = document.getElementById(id);
  const len = path.getTotalLength();
  path.style.strokeDasharray = len;
  path.style.strokeDashoffset = len;
  gsap.to(path, {
    strokeDashoffset: 0,
    ease: "none",
    scrollTrigger: {
      trigger: ".journey__river-wrap",
      start: "top 75%",
      end: "bottom 55%",
      scrub: 0.8 + i * 0.4, // shimmer trails the current slightly
    },
  });
});

/* ─────────────────────────────────────────────────────────────
   7 · THE GARDEN — flowers bloom into view
   ───────────────────────────────────────────────────────────── */

const skills = [
  { label: "Product strategy", petals: 6, color: "#f2a9c4", center: "#ffe9a8" },
  { label: "UX research & flows", petals: 5, color: "#a9c8f2", center: "#fff3c9" },
  { label: "Interface & interaction", petals: 7, color: "#cdb8e8", center: "#ffe0b8" },
  { label: "AI-accelerated building", petals: 6, color: "#ffd9c7", center: "#f9f3b6" },
  { label: "Prototyping & motion", petals: 5, color: "#a8e0cf", center: "#fce9ad" },
  { label: "Storytelling", petals: 8, color: "#f6c9b8", center: "#fdf0c0" },
];

const garden = document.getElementById("garden");
skills.forEach((skill, idx) => {
  const stemH = 60 + (idx % 3) * 26;
  const btn = document.createElement("button");
  btn.className = "flower";
  btn.type = "button";
  btn.setAttribute("aria-label", skill.label);

  let petalPaths = "";
  for (let p = 0; p < skill.petals; p++) {
    const angle = (360 / skill.petals) * p;
    petalPaths += `<ellipse class="petal" cx="0" cy="-17" rx="9.5" ry="17"
      fill="${skill.color}" opacity="0.9" transform="rotate(${angle})"></ellipse>`;
  }

  btn.innerHTML = `
    <svg width="90" height="${100 + stemH}" viewBox="-45 -45 90 ${100 + stemH}" aria-hidden="true">
      <path class="flower__stem" d="M0,28 C ${idx % 2 ? "-" : ""}8,${40 + stemH * 0.4} ${idx % 2 ? "" : "-"}6,${30 + stemH * 0.7} 0,${28 + stemH}"
        fill="none" stroke="#7fb89a" stroke-width="3.5" stroke-linecap="round" />
      <ellipse class="flower__leaf" cx="${idx % 2 ? -11 : 11}" cy="${34 + stemH * 0.45}" rx="10" ry="4.5"
        fill="#9fd0b4" transform="rotate(${idx % 2 ? -28 : 28} ${idx % 2 ? -11 : 11} ${34 + stemH * 0.45})" />
      <g class="flower__head">${petalPaths}
        <circle cx="0" cy="0" r="9" fill="${skill.center}" />
      </g>
    </svg>
    <span class="flower__label">${skill.label}</span>`;
  garden.appendChild(btn);

  btn.addEventListener("click", () => chime(523 + idx * 55));
});

if (!prefersReducedMotion) {
  document.querySelectorAll(".flower").forEach((f, i) => {
    const head = f.querySelector(".flower__head");
    const stem = f.querySelector(".flower__stem");
    const leaf = f.querySelector(".flower__leaf");
    const stemLen = stem.getTotalLength();
    stem.style.strokeDasharray = stemLen;
    stem.style.strokeDashoffset = stemLen;
    gsap.set(head, { scale: 0, rotation: -80, transformOrigin: "center" });
    gsap.set(leaf, { scale: 0, transformOrigin: "center" });

    const tl = gsap.timeline({
      scrollTrigger: { trigger: "#garden", start: "top 78%" },
      delay: i * 0.14,
      onComplete: () => f.classList.add("is-bloomed"),
    });
    tl.to(stem, { strokeDashoffset: 0, duration: 0.7, ease: "power2.out" })
      .to(leaf, { scale: 1, duration: 0.4, ease: "back.out(2.5)" }, "-=0.25")
      .to(head, { scale: 1, rotation: 0, duration: 1.1, ease: "elastic.out(1, 0.55)" }, "-=0.2");
  });
} else {
  document.querySelectorAll(".flower").forEach((f) => f.classList.add("is-bloomed"));
}

/* ─────────────────────────────────────────────────────────────
   8 · CONSTELLATIONS — each project draws its own stars
   ───────────────────────────────────────────────────────────── */

document.querySelectorAll(".project").forEach((card) => {
  const skyEl = card.querySelector(".project__sky");
  const n = parseInt(card.dataset.stars, 10) || 6;
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push({
      x: 8 + (i / (n - 1)) * 84 + (Math.random() - 0.5) * 10,
      y: 12 + Math.random() * 45,
    });
  }
  let svg = `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">`;
  let d = "";
  pts.forEach((p, i) => { d += `${i === 0 ? "M" : "L"}${p.x},${p.y} `; });
  svg += `<path class="const-line" d="${d}"></path>`;
  pts.forEach((p, i) => {
    svg += `<circle class="const-star" cx="${p.x}" cy="${p.y}" r="${0.8 + Math.random() * 0.9}"
      style="animation-delay:${(i * 0.4).toFixed(1)}s"></circle>`;
  });
  /* faint background stars */
  for (let i = 0; i < 16; i++) {
    svg += `<circle cx="${Math.random() * 100}" cy="${Math.random() * 100}" r="${0.25 + Math.random() * 0.35}"
      fill="#aab4e8" opacity="${0.25 + Math.random() * 0.4}"></circle>`;
  }
  svg += `</svg>`;
  skyEl.innerHTML = svg;

  const line = skyEl.querySelector(".const-line");
  const len = line.getTotalLength();
  line.style.setProperty("--len", len);

  /* touch devices can't hover — draw when the card scrolls in */
  if (isTouch) {
    ScrollTrigger.create({
      trigger: card,
      start: "top 70%",
      onEnter: () => (line.style.strokeDashoffset = 0),
    });
  }
});

/* ─────────────────────────────────────────────────────────────
   9 · SHOOTING STARS — click the night sky
   ───────────────────────────────────────────────────────────── */

function shootStar(x, y) {
  const star = document.createElement("div");
  star.className = "shooting-star";
  const angle = 20 + Math.random() * 25;
  star.style.left = `${x}px`;
  star.style.top = `${y}px`;
  star.style.transform = `rotate(${angle}deg)`;
  document.body.appendChild(star);
  const dist = 300 + Math.random() * 400;
  gsap.fromTo(
    star,
    { opacity: 0 },
    {
      opacity: 1,
      duration: 0.15,
      onComplete() {
        gsap.to(star, {
          x: -Math.cos((angle * Math.PI) / 180) * dist,
          y: Math.sin((angle * Math.PI) / 180) * dist,
          opacity: 0,
          duration: 0.9,
          ease: "power2.in",
          onComplete: () => star.remove(),
        });
      },
    }
  );
  chime(880 + Math.random() * 300, 0.12);
}

document.getElementById("contact").addEventListener("pointerdown", (e) => {
  if (e.target.closest("a, button")) return;
  shootStar(e.clientX + 60, e.clientY - 40);
});
/* ambient shooting stars while the night section is in view */
if (!prefersReducedMotion) {
  setInterval(() => {
    if (!document.body.classList.contains("is-night") || document.hidden) return;
    if (Math.random() < 0.5) {
      shootStar(window.innerWidth * (0.3 + Math.random() * 0.6), window.innerHeight * (0.1 + Math.random() * 0.3));
    }
  }, 6000);
}

/* ─────────────────────────────────────────────────────────────
   10 · LITTLE WONDERS — hidden delights to collect
   ───────────────────────────────────────────────────────────── */

const wonders = document.querySelectorAll(".wonder");
const counterEl = document.getElementById("wonderCounter");
const toast = document.getElementById("wonderToast");
let found = 0;
let toastTimer;

wonders.forEach((w) => {
  const activate = () => {
    if (!w.classList.contains("is-found")) {
      w.classList.add("is-found");
      found++;
      counterEl.textContent =
        found === wonders.length
          ? `little wonders found: ${found} / ${wonders.length} — you see everything ✦`
          : `little wonders found: ${found} / ${wonders.length}`;
    }
    toast.textContent = `✦ ${w.dataset.wonder}`;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3600);
    chime(659, 0.18);
  };
  w.addEventListener("click", activate);
  w.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
  });
});

/* ─────────────────────────────────────────────────────────────
   11 · CURSOR SPARKLES — desktop only, gently rationed
   ───────────────────────────────────────────────────────────── */

if (!isTouch && !prefersReducedMotion) {
  let lastSparkle = 0;
  window.addEventListener("pointermove", (e) => {
    const now = performance.now();
    if (now - lastSparkle < 120) return;
    lastSparkle = now;
    if (Math.random() < 0.4) return;
    const s = document.createElement("span");
    s.className = "sparkle";
    s.textContent = Math.random() < 0.5 ? "✦" : "✧";
    s.style.left = `${e.clientX + (Math.random() - 0.5) * 18}px`;
    s.style.top = `${e.clientY + (Math.random() - 0.5) * 18}px`;
    document.body.appendChild(s);
    gsap.fromTo(
      s,
      { scale: 0, opacity: 1, rotate: 0 },
      {
        scale: 0.9 + Math.random() * 0.5,
        opacity: 0,
        rotate: 120,
        y: 18 + Math.random() * 14,
        duration: 1,
        ease: "power1.out",
        onComplete: () => s.remove(),
      }
    );
  });
}

/* ─────────────────────────────────────────────────────────────
   12 · SOUND — a tiny generative music box (no audio files)
   ───────────────────────────────────────────────────────────── */

let audioCtx = null;
let masterGain = null;
let padNodes = [];
let melodyTimer = null;
let soundOn = false;

const PENTATONIC = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25]; // C major pentatonic

function initAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(audioCtx.destination);

  /* warm pad: two detuned triangles through a slow-breathing gain */
  [130.81, 196.0].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    osc.detune.value = i === 0 ? -4 : 5;
    const g = audioCtx.createGain();
    g.gain.value = 0.05;
    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 0.08 + i * 0.05;
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 0.025;
    lfo.connect(lfoGain).connect(g.gain);
    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700;
    osc.connect(filter).connect(g).connect(masterGain);
    osc.start();
    lfo.start();
    padNodes.push(osc, lfo);
  });
}

/* one soft music-box note */
function chime(freq = 523, vol = 0.14) {
  if (!soundOn || !audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
  osc.connect(g).connect(masterGain);
  osc.start(t);
  osc.stop(t + 2.3);
}

function scheduleMelody() {
  melodyTimer = setInterval(() => {
    if (!soundOn || document.hidden) return;
    if (Math.random() < 0.65) {
      const note = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
      const octave = Math.random() < 0.3 ? 2 : 1;
      chime(note * octave, 0.07 + Math.random() * 0.05);
    }
  }, 1900);
}

const soundToggle = document.getElementById("soundToggle");
soundToggle.addEventListener("click", () => {
  if (!audioCtx) {
    initAudio();
    scheduleMelody();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  soundOn = !soundOn;
  soundToggle.setAttribute("aria-pressed", String(soundOn));
  gsap.to(masterGain.gain, { value: soundOn ? 0.6 : 0, duration: 1.5 });
  if (soundOn) chime(523.25, 0.12);
});

/* ─────────────────────────────────────────────────────────────
   13 · ODDS & ENDS
   ───────────────────────────────────────────────────────────── */

document.getElementById("year").textContent = new Date().getFullYear();

/* keep ScrollTrigger honest after fonts/layout settle */
window.addEventListener("load", () => ScrollTrigger.refresh());
