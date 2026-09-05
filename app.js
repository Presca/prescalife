/* Tour Guide Buddy — a cheerful, location-aware tour guide.
 *
 * Live mode: watches your position, asks Wikipedia's geosearch API for
 * notable places within earshot, and announces each one exactly once with
 * a picture, a short quip, and one trimmed fact — read aloud by default.
 * Demo mode: a simulated stroll past world icons, no GPS needed.
 */

(() => {
  "use strict";

  // ---------- config ----------
  const SEARCH_RADIUS_M = 250;      // "we're passing it" distance
  const MIN_MOVE_M = 25;            // re-scan only after moving this far
  const MIN_SCAN_INTERVAL_MS = 12000;
  const MAX_FACT_CHARS = 300;       // keep it short and impactful
  const MAX_ANNOUNCE_PER_SCAN = 2;  // never blab

  const WIKI_API = "https://en.wikipedia.org/w/api.php";
  const WIKI_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/";

  // ---------- tour guide personality ----------
  const QUIPS = [
    "Oh, would you look at that — act casual.",
    "Eyes left. Or right. One of those.",
    "Quick, pretend you knew this was here.",
    "Fun fact incoming. No refunds.",
    "You're walking past greatness. Literally.",
    "Locals pretend not to notice this. You may stare.",
    "This one's on every postcard for a reason.",
    "I'll keep this short. Unlike its history.",
    "Free tour fact. Tipping me is impossible, sadly.",
    "History alert. Please remain calm.",
  ];

  const SKIP_TITLE_RE = /^(list of|timeline of|history of|geography of|demographics of)/i;

  // ---------- state ----------
  const state = {
    mode: "idle",           // idle | live | demo
    watchId: null,
    lastScan: { lat: null, lon: null, time: 0 },
    prevFix: null,          // previous GPS fix, for deriving heading
    heading: null,          // degrees clockwise from north, null = unknown
    seen: new Set(),        // page titles already announced this tour
    voiceOn: true,          // facts are read aloud by default
    speechPaused: false,
    demoTimer: null,
    quipBag: [],
  };

  // ---------- dom ----------
  const $ = (id) => document.getElementById(id);
  const feed = $("feed");
  const hero = $("hero");
  const statusLine = $("status-line");
  const dock = $("dock");
  const dockText = $("dock-text");
  const dockIcon = $("dock-icon");

  $("start-btn").addEventListener("click", startLiveTour);
  $("demo-btn").addEventListener("click", startDemoTour);
  $("stop-btn").addEventListener("click", () => endTour("Tour over. Nice strolling with you! 🌤️"));
  $("voice-toggle").addEventListener("click", toggleVoice);
  $("refresh-btn").addEventListener("click", refreshLocation);
  $("pause-btn").addEventListener("click", togglePause);
  $("home-btn").addEventListener("click", goHome);
  $("home-btn").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goHome(); }
  });
  $("collection-btn").addEventListener("click", () => toggleCollection(true));
  $("collection-close").addEventListener("click", () => toggleCollection(false));
  $("snap-input").addEventListener("change", onSnapPicked);

  // ---------- snaps & collection ----------
  // Snapped places live in localStorage: [{title, img, date, url}], newest first.
  const COLLECTION_KEY = "tgb-collection";
  let snapTarget = null; // the card awaiting a camera picture

  function loadCollection() {
    try { return JSON.parse(localStorage.getItem(COLLECTION_KEY)) || []; }
    catch { return []; }
  }

  function saveCollection(items) {
    try { localStorage.setItem(COLLECTION_KEY, JSON.stringify(items)); return true; }
    catch { return false; }
  }

  // Same place = same title, or a stored snap within 60 m. Coordinates are
  // the lasting identity (titles can vary); the title check keeps matches
  // honest where two landmarks sit close together.
  const SAME_PLACE_M = 60;

  function samePlace(a, entry) {
    if (a.title === entry.title) return true;
    return a.lat != null && entry.lat != null &&
      distanceMeters(a.lat, a.lon, entry.lat, entry.lon) < SAME_PLACE_M;
  }

  function findSnap(title, lat, lon) {
    const probe = { title, lat, lon };
    return loadCollection().find((i) => samePlace(i, probe)) || null;
  }

  function addToCollection(entry) {
    const items = loadCollection().filter((i) => !samePlace(i, entry));
    items.unshift(entry);
    // storage full → drop oldest snaps until it fits
    while (!saveCollection(items) && items.length > 1) items.pop();
    updateCollectionBadge();
  }

  // Which country is this spot in? Free keyless reverse geocoding.
  async function countryFor(lat, lon) {
    if (lat == null) return null;
    try {
      const res = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
      );
      if (!res.ok) return null;
      const d = await res.json();
      return d.countryName ? { country: d.countryName, cc: d.countryCode } : null;
    } catch {
      return null;
    }
  }

  function flagEmoji(cc) {
    if (!cc || cc.length !== 2) return "🌍";
    return [...cc.toUpperCase()]
      .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
      .join("");
  }

  // Fill in countries for snaps saved before we started recording them.
  let backfilling = false;
  async function backfillCountries() {
    if (backfilling) return;
    backfilling = true;
    try {
      const items = loadCollection();
      let changed = false;
      for (const it of items) {
        if (!it.country && it.lat != null) {
          const geo = await countryFor(it.lat, it.lon);
          if (geo) { it.country = geo.country; it.cc = geo.cc; changed = true; }
        }
      }
      if (changed) {
        saveCollection(items);
        if (!$("collection").classList.contains("hidden")) renderCollection();
      }
    } finally {
      backfilling = false;
    }
  }

  function updateCollectionBadge() {
    const n = loadCollection().length;
    $("collection-btn").textContent = n > 0 ? `📚${n}` : "📚";
  }

  function toggleCollection(show) {
    const el = $("collection");
    el.classList.toggle("hidden", !show);
    if (show) renderCollection();
  }

  function renderCollection() {
    const container = $("collection-grid");
    container.textContent = "";
    const items = loadCollection();
    $("collection-empty").classList.toggle("hidden", items.length > 0);

    // group stamps by country, unknowns last
    const groups = new Map();
    for (const it of items) {
      const key = it.country || "Somewhere on Earth";
      if (!groups.has(key)) groups.set(key, { cc: it.cc, items: [] });
      groups.get(key).items.push(it);
    }
    const ordered = [...groups.entries()].sort(([a], [b]) =>
      a === "Somewhere on Earth" ? 1 : b === "Somewhere on Earth" ? -1 : a.localeCompare(b)
    );

    for (const [country, group] of ordered) {
      const head = document.createElement("h3");
      head.className = "country-head";
      head.textContent = `${flagEmoji(group.cc)} ${country} `;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = `${group.items.length} stamp${group.items.length === 1 ? "" : "s"}`;
      head.appendChild(count);
      container.appendChild(head);

      const grid = document.createElement("div");
      grid.className = "country-grid";
      for (const it of group.items) {
        const stamp = document.createElement("div");
        stamp.className = "mini-stamp";
        const shape = document.createElement("div");
        shape.className = "stamp-shape";
        stamp.appendChild(shape);
        const img = document.createElement("img");
        img.src = it.img;
        img.alt = it.title;
        shape.appendChild(img);
        const name = document.createElement("p");
        name.className = "mini-name";
        name.textContent = it.title;
        shape.appendChild(name);
        const date = document.createElement("p");
        date.className = "mini-date";
        date.textContent = `📸 ${it.date}`;
        shape.appendChild(date);
        grid.appendChild(stamp);
      }
      container.appendChild(grid);
    }

    backfillCountries();
  }

  function onSnapPicked(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    const target = snapTarget;
    snapTarget = null;
    if (!file || !target) return;
    downscalePhoto(file).then(async (dataUrl) => {
      if (!dataUrl) return;
      target.setImage(dataUrl);
      target.markSnapped();
      const geo = await countryFor(target.lat ?? null, target.lon ?? null);
      addToCollection({
        title: target.title,
        img: dataUrl,
        date: new Date().toISOString().slice(0, 10),
        url: target.url || null,
        lat: target.lat ?? null,
        lon: target.lon ?? null,
        country: geo?.country || null,
        cc: geo?.cc || null,
      });
    });
  }

  // Shrink a camera photo so a whole collection fits in localStorage.
  async function downscalePhoto(file) {
    try {
      let src, w, h;
      if (window.createImageBitmap) {
        src = await createImageBitmap(file, { imageOrientation: "from-image" })
          .catch(() => createImageBitmap(file));
        w = src.width; h = src.height;
      } else {
        src = await new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = URL.createObjectURL(file);
        });
        w = src.naturalWidth; h = src.naturalHeight;
      }
      const scale = Math.min(1, 900 / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.getContext("2d").drawImage(src, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.72);
    } catch {
      return null;
    }
  }

  updateCollectionBadge();

  // ---------- map ----------
  let map = null, userMarker = null, spotLine = null, spotLayer = null;

  function ensureMap() {
    if (!window.L) return null; // map library unavailable → facts still flow
    if (map) return map;
    map = L.map("map", { zoomControl: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    spotLayer = L.layerGroup().addTo(map);
    return map;
  }

  function pin(emoji, cls) {
    return L.divIcon({
      className: "",
      html: `<div class="map-pin ${cls || ""}">${emoji}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 24],
    });
  }

  function showMap() {
    $("map-panel").classList.remove("hidden");
    if (map) setTimeout(() => map.invalidateSize(), 60);
  }

  function mapUser(lat, lon) {
    if (!ensureMap()) return;
    showMap();
    if (!userMarker) {
      userMarker = L.marker([lat, lon], { icon: pin("🚶", "you"), zIndexOffset: 1000 }).addTo(map);
      map.setView([lat, lon], 16);
    } else {
      userMarker.setLatLng([lat, lon]);
    }
  }

  function mapSpot(uLat, uLon, lat, lon, title) {
    if (lat == null || !ensureMap()) return;
    showMap();
    L.marker([lat, lon], { icon: pin("📍") }).addTo(spotLayer).bindTooltip(title);
    if (spotLine) spotLine.remove();
    spotLine = L.polyline([[uLat, uLon], [lat, lon]], {
      color: "#e8763c",
      weight: 3,
      dashArray: "6 8",
    }).addTo(map);
    map.fitBounds(L.latLngBounds([uLat, uLon], [lat, lon]), { padding: [40, 40], maxZoom: 17 });
  }

  function resetMap() {
    $("map-panel").classList.add("hidden");
    if (!map) return;
    spotLayer.clearLayers();
    if (spotLine) { spotLine.remove(); spotLine = null; }
    if (userMarker) { userMarker.remove(); userMarker = null; }
  }

  // ---------- ui helpers ----------
  function setStatus(text) { statusLine.textContent = text; }
  function setDock(text, icon) {
    dockText.textContent = text;
    if (icon) dockIcon.textContent = icon;
  }

  function showTouring(label) {
    hero.classList.add("hidden");
    dock.classList.remove("hidden");
    setStatus(label);
  }

  // Card with "start again" actions, shown when a tour ends.
  function restartCard() {
    const el = document.createElement("div");
    el.className = "card system";
    el.textContent = "Feet rested? The world still has facts in it.";

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const live = document.createElement("button");
    live.className = "btn primary small";
    live.textContent = "▶ Start a new tour";
    live.addEventListener("click", startLiveTour);
    actions.appendChild(live);

    const demo = document.createElement("button");
    demo.className = "btn ghost small";
    demo.textContent = "🛋️ Replay demo";
    demo.addEventListener("click", startDemoTour);
    actions.appendChild(demo);

    el.appendChild(actions);
    feed.appendChild(el);
    el.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  function systemCard(text) {
    const el = document.createElement("div");
    el.className = "card system";
    el.textContent = text;
    feed.appendChild(el);
    el.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  // Travel-stamp fact card. Shows an emoji tile until a real photo arrives;
  // returns a setImage(url) hook so images can load in after the card pops.
  function factCard({ title, quip, fact, distance, url, image, emoji, direction, lat, lon }) {
    const el = document.createElement("article");
    el.className = "card";
    const body = document.createElement("div");
    body.className = "stamp-shape";
    el.appendChild(body);
    const inner = document.createElement("div");
    inner.className = "stamp-inner";
    body.appendChild(inner);

    const media = document.createElement("div");
    media.className = "card-media";
    media.textContent = emoji || "📍";
    inner.appendChild(media);

    // once the user's own photo is on the card, web images can't replace it
    let lockedByUser = false;
    const rawSetImage = (src) => {
      if (!src) return;
      const img = document.createElement("img");
      img.alt = title;
      // no loading="lazy": a detached lazy image never loads, so onload
      // would never fire and the photo would never replace the emoji
      img.onload = () => { media.textContent = ""; media.appendChild(img); };
      img.src = src;
    };
    const setImage = (src) => { if (!lockedByUser) rawSetImage(src); };

    const priorSnap = findSnap(title, lat, lon);
    if (priorSnap) {
      lockedByUser = true;
      rawSetImage(priorSnap.img);
    } else {
      setImage(image);
    }

    const top = document.createElement("div");
    top.className = "card-top";
    const place = document.createElement("h3");
    place.className = "card-place";
    place.textContent = title;
    top.appendChild(place);
    if (distance != null) {
      const dist = document.createElement("span");
      dist.className = "card-dist";
      dist.textContent = `${direction ? direction.arrow + " " : ""}~${Math.round(distance)} m`;
      if (direction) dist.title = direction.say;
      top.appendChild(dist);
    }
    inner.appendChild(top);

    const quipEl = document.createElement("p");
    quipEl.className = "card-quip";
    quipEl.textContent = priorSnap
      ? `Welcome back! You snapped this one on ${priorSnap.date}. 🌟`
      : quip;
    inner.appendChild(quipEl);

    const factEl = document.createElement("p");
    factEl.className = "card-fact";
    factEl.textContent = fact;
    inner.appendChild(factEl);

    const foot = document.createElement("div");
    foot.className = "card-foot";
    if (url) {
      const link = document.createElement("a");
      link.className = "card-link";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Rabbit hole →";
      foot.appendChild(link);
    }
    const snap = document.createElement("button");
    snap.className = "btn ghost small snap-btn";
    snap.textContent = priorSnap ? "📸 Snap again" : "📸 I was here!";
    snap.addEventListener("click", () => {
      snapTarget = {
        title,
        url,
        lat,
        lon,
        setImage: (src) => { lockedByUser = true; rawSetImage(src); },
        markSnapped: () => {
          snap.textContent = "⭐ Snapped!";
          snap.disabled = true;
        },
      };
      $("snap-input").click();
    });
    foot.appendChild(snap);
    inner.appendChild(foot);

    feed.appendChild(el);
    el.scrollIntoView({ behavior: "smooth", block: "end" });
    const welcome = priorSnap ? "Welcome back! " : "";
    speak(`${welcome}${spokenIntro(direction, distance)} ${title}. ${fact}`.trim());
    return { setImage };
  }

  // ---------- personality helpers ----------
  function nextQuip() {
    if (state.quipBag.length === 0) {
      state.quipBag = [...QUIPS].sort(() => Math.random() - 0.5);
    }
    return state.quipBag.pop();
  }

  // Trim an extract to at most MAX_FACT_CHARS, ending on a sentence.
  function trimFact(text) {
    if (!text) return null;
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length <= MAX_FACT_CHARS) return clean;
    const slice = clean.slice(0, MAX_FACT_CHARS);
    const lastStop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
    return lastStop > 60 ? slice.slice(0, lastStop + 1) : slice.trimEnd() + "…";
  }

  // ---------- voice ----------
  const speechOK = "speechSynthesis" in window;
  let chosenVoice = null;

  // Devices ship far nicer voices than the API default; prefer the ones
  // marketed as natural/neural/enhanced, then well-known pleasant names.
  function pickVoice() {
    if (chosenVoice) return chosenVoice;
    const en = speechSynthesis.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
    if (en.length === 0) return null;
    const score = (v) => {
      const n = v.name.toLowerCase();
      let s = 0;
      if (/natural|neural/.test(n)) s += 6;
      if (/premium|enhanced/.test(n)) s += 5;
      if (/siri/.test(n)) s += 4;
      if (/google/.test(n)) s += 3;
      if (/samantha|karen|daniel|moira|tessa|serena|ava|allison|zoe/.test(n)) s += 2;
      if (/^en[-_]?(us|gb|au|ie)/i.test(v.lang)) s += 1;
      return s;
    };
    chosenVoice = en.sort((a, b) => score(b) - score(a))[0];
    return chosenVoice;
  }
  if (speechOK) {
    speechSynthesis.onvoiceschanged = () => { chosenVoice = null; pickVoice(); };
  }

  function toggleVoice() {
    state.voiceOn = !state.voiceOn;
    const btn = $("voice-toggle");
    btn.setAttribute("aria-pressed", String(state.voiceOn));
    btn.textContent = state.voiceOn ? "🔊" : "🔇";
    if (!state.voiceOn && speechOK) {
      speechSynthesis.resume();
      speechSynthesis.cancel();
    }
    setPaused(false);
  }

  function speak(text) {
    if (!state.voiceOn || !speechOK) return;
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.rate = 1.0;
    u.pitch = 1.03;
    u.onend = () => { if (!speechSynthesis.speaking) setPaused(false); };
    // while paused, new facts queue up and play on resume
    speechSynthesis.speak(u);
  }

  // Some browsers only allow speech after a user gesture; an empty
  // utterance on the start tap unlocks it for the rest of the tour.
  function unlockSpeech() {
    if (!speechOK) return;
    pickVoice();
    const u = new SpeechSynthesisUtterance("");
    u.volume = 0;
    speechSynthesis.speak(u);
  }

  function setPaused(v) {
    state.speechPaused = v;
    updatePauseBtn();
  }

  function updatePauseBtn() {
    const btn = $("pause-btn");
    btn.textContent = state.speechPaused ? "▶️" : "⏸️";
    btn.title = state.speechPaused ? "Resume narration" : "Pause narration";
    btn.classList.toggle("hidden", !state.voiceOn);
  }

  function togglePause() {
    if (!speechOK || !state.voiceOn) return;
    if (state.speechPaused) {
      speechSynthesis.resume();
      setPaused(false);
    } else if (speechSynthesis.speaking) {
      speechSynthesis.pause();
      setPaused(true);
    }
  }

  // ---------- refresh location ----------
  let lastRefresh = 0;

  // Force a fresh GPS fix and immediate scan, skipping the movement gate.
  function refreshLocation() {
    if (state.mode !== "live") return;
    const now = Date.now();
    if (now - lastRefresh < 5000) {
      setDock("Easy! Still refreshing…", "🔄");
      return;
    }
    lastRefresh = now;

    const btn = $("refresh-btn");
    btn.classList.add("spinning");
    setDock("Getting a fresh fix…", "📡");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        state.lastScan = { lat, lon, time: Date.now() };
        scanNearby(lat, lon)
          .catch(() => setDock("Network hiccup — try again in a sec.", "📡"))
          .finally(() => btn.classList.remove("spinning"));
      },
      () => {
        btn.classList.remove("spinning");
        setDock("Couldn't refresh the fix. Sky helps.", "📡");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }

  // ---------- live tour ----------
  function startLiveTour() {
    if (!("geolocation" in navigator)) {
      systemCard("No geolocation on this device. Try the couch demo — zero walking required.");
      return;
    }
    resetTour("live");
    unlockSpeech();
    showTouring("On tour! Wander freely.");
    setDock("Locking onto your position…", "📡");
    systemCard("Tour started! Walk around — I'll pipe up when we pass somewhere iconic. 🚶");

    state.watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 20000,
    });
  }

  function onGeoError(err) {
    const msg = err.code === err.PERMISSION_DENIED
      ? "Location permission denied. A tour guide without a map is just a person shouting. Allow location, or try the couch demo."
      : "Couldn't get a GPS fix. Sky visibility helps — I'm a guide, not a mole.";
    systemCard(msg);
    endTour("Ready when you are!");
  }

  function onPosition(pos) {
    const { latitude: lat, longitude: lon } = pos.coords;
    const now = Date.now();
    const { lastScan } = state;

    // Which way are we facing? Trust the GPS heading while moving;
    // otherwise derive it from the last two fixes.
    if (Number.isFinite(pos.coords.heading) && (pos.coords.speed ?? 0) > 0.4) {
      state.heading = pos.coords.heading;
    } else if (state.prevFix && distanceMeters(state.prevFix.lat, state.prevFix.lon, lat, lon) > 10) {
      state.heading = bearingDeg(state.prevFix.lat, state.prevFix.lon, lat, lon);
    }
    state.prevFix = { lat, lon };
    mapUser(lat, lon);

    const moved = lastScan.lat == null
      ? Infinity
      : distanceMeters(lat, lon, lastScan.lat, lastScan.lon);

    if (moved < MIN_MOVE_M || now - lastScan.time < MIN_SCAN_INTERVAL_MS) return;

    state.lastScan = { lat, lon, time: now };
    setDock("Scanning for landmarks…", "📡");
    scanNearby(lat, lon).catch(() => {
      setDock("Network hiccup — still watching.", "📡");
    });
  }

  async function scanNearby(lat, lon) {
    const params = new URLSearchParams({
      action: "query",
      list: "geosearch",
      gscoord: `${lat}|${lon}`,
      gsradius: String(SEARCH_RADIUS_M),
      gslimit: "10",
      format: "json",
      origin: "*",
    });
    const res = await fetch(`${WIKI_API}?${params}`);
    if (!res.ok) throw new Error(`geosearch ${res.status}`);
    const data = await res.json();

    const hits = (data?.query?.geosearch ?? [])
      .filter((p) => !state.seen.has(p.title) && !SKIP_TITLE_RE.test(p.title))
      .slice(0, MAX_ANNOUNCE_PER_SCAN);

    if (hits.length === 0) {
      setDock("All quiet. Keep strolling…", "🚶");
      return;
    }

    for (const hit of hits) {
      state.seen.add(hit.title);
      const [summary, story] = await Promise.all([
        fetchSummary(hit.title),
        fetchStory(hit.title),
      ]);
      if (!summary) continue;
      factCard({
        title: summary.title,
        quip: nextQuip(),
        fact: story || summary.fact,
        distance: hit.dist,
        url: summary.url,
        image: summary.image,
        direction: relativeDirection(lat, lon, hit.lat, hit.lon),
        lat: hit.lat,
        lon: hit.lon,
      });
      mapSpot(lat, lon, hit.lat, hit.lon, summary.title);
    }
    setDock(`${state.seen.size} spot${state.seen.size === 1 ? "" : "s"} covered. Onward!`, "🧭");
  }

  // Headings whose section reads like a story rather than a definition.
  const STORY_HEADINGS = /^(history|origins?|construction|background|early history|founding|etymology and history|development)$/i;

  // Pull the opening of the article's History-like section, so the guide
  // tells you the story of a place instead of just defining it.
  async function fetchStory(title) {
    try {
      const params = new URLSearchParams({
        action: "query",
        prop: "extracts",
        explaintext: "1",
        exsectionformat: "wiki",
        redirects: "1",
        titles: title,
        format: "json",
        origin: "*",
      });
      const res = await fetch(`${WIKI_API}?${params}`);
      if (!res.ok) return null;
      const pages = (await res.json())?.query?.pages ?? {};
      const text = Object.values(pages)[0]?.extract;
      if (!text) return null;
      // plain text arrives with "== Heading ==" markers between sections
      const parts = text.split(/^==\s*([^=\n]+?)\s*==\s*$/m);
      for (let i = 1; i < parts.length - 1; i += 2) {
        if (!STORY_HEADINGS.test(parts[i].trim())) continue;
        const body = parts[i + 1].replace(/^===.*$/gm, " ").trim();
        const story = trimFact(body);
        if (story && story.length > 60) return story;
      }
      return null;
    } catch {
      return null;
    }
  }

  async function fetchSummary(title) {
    try {
      const res = await fetch(WIKI_SUMMARY + encodeURIComponent(title));
      if (!res.ok) return null;
      const data = await res.json();
      const fact = trimFact(data.extract);
      if (!fact) return null;
      return {
        title: data.title || title,
        fact,
        url: data.content_urls?.desktop?.page,
        image: data.thumbnail?.source,
      };
    } catch {
      return null;
    }
  }

  // ---------- demo tour ----------
  const DEMO_STOPS = [
    {
      title: "Eiffel Tower",
      lat: 48.8584, lon: 2.2945,
      emoji: "🗼",
      fact: "Gustave Eiffel kept a secret apartment at the top for entertaining guests like Thomas Edison. Paris's most exclusive flat, and the landlord never rented it out.",
      url: "https://en.wikipedia.org/wiki/Eiffel_Tower",
    },
    {
      title: "Colosseum",
      lat: 41.8902, lon: 12.4922,
      emoji: "🏟️",
      fact: "It could reportedly be flooded for mock naval battles. Romans invented the pool party, then made it a blood sport.",
      url: "https://en.wikipedia.org/wiki/Colosseum",
    },
    {
      title: "Big Ben",
      lat: 51.5007, lon: -0.1246,
      emoji: "🕰️",
      fact: "Big Ben is technically just the bell — the tower is the Elizabeth Tower. Correcting people about this is a beloved British pastime.",
      url: "https://en.wikipedia.org/wiki/Big_Ben",
    },
    {
      title: "Statue of Liberty",
      lat: 40.6892, lon: -74.0445,
      emoji: "🗽",
      fact: "She was delivered from France in 350 pieces packed in 214 crates — history's most stressful IKEA order.",
      url: "https://en.wikipedia.org/wiki/Statue_of_Liberty",
    },
    {
      title: "Great Pyramid of Giza",
      lat: 29.9792, lon: 31.1342,
      emoji: "🐫",
      fact: "It was the tallest human-made structure for about 3,800 years. The record now changes hands every decade; the pyramid is unbothered.",
      url: "https://en.wikipedia.org/wiki/Great_Pyramid_of_Giza",
    },
    {
      title: "Sydney Opera House",
      lat: -33.8568, lon: 151.2153,
      emoji: "🎭",
      fact: "Budgeted at 7 million dollars, it landed at 102 million and ten years late — proof that every great project estimate is a work of fiction.",
      url: "https://en.wikipedia.org/wiki/Sydney_Opera_House",
    },
  ];

  function startDemoTour() {
    resetTour("demo");
    unlockSpeech();
    showTouring("Couch demo. Zero steps required.");
    setDock("Simulating a very glamorous stroll…", "🛋️");
    systemCard("Demo tour: pretend we're power-walking past the world's greatest hits. 🌍");

    let i = 0;
    const step = () => {
      if (state.mode !== "demo") return;
      if (i >= DEMO_STOPS.length) {
        systemCard("Demo complete. Now go outside and try it for real — I'll be here. 🌤️");
        endTour("Ready when you are!");
        return;
      }
      const stop = DEMO_STOPS[i++];
      const demoDirs = [
        { say: "Straight ahead", arrow: "⬆️" },
        { say: "On your right", arrow: "➡️" },
        { say: "On your left", arrow: "⬅️" },
      ];
      const card = factCard({
        ...stop,
        quip: nextQuip(),
        distance: 40 + Math.floor(Math.random() * 160),
        direction: demoDirs[Math.floor(Math.random() * demoDirs.length)],
      });
      // teleport our imaginary self ~150 m from the stop and frame both
      const youLat = stop.lat + 0.0012, youLon = stop.lon + 0.0009;
      mapUser(youLat, youLon);
      if (userMarker) userMarker.setLatLng([youLat, youLon]);
      mapSpot(youLat, youLon, stop.lat, stop.lon, stop.title);
      // pull the real photo from Wikipedia; the emoji covers any failure
      fetchSummary(stop.title).then((s) => card.setImage(s?.image));
      setDock(`${i}/${DEMO_STOPS.length} icons casually passed.`, "🧭");
      state.demoTimer = setTimeout(step, 3800);
    };
    step();
  }

  // ---------- lifecycle ----------
  function resetTour(mode) {
    stopWatching();
    state.mode = mode;
    state.seen.clear();
    state.lastScan = { lat: null, lon: null, time: 0 };
    state.prevFix = null;
    state.heading = null;
    feed.querySelectorAll(".card").forEach((c) => c.remove());
    $("refresh-btn").classList.toggle("hidden", mode !== "live");
    setPaused(false);
    resetMap();
  }

  function stopWatching() {
    if (state.watchId != null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
    if (state.demoTimer != null) {
      clearTimeout(state.demoTimer);
      state.demoTimer = null;
    }
    if (speechOK) {
      speechSynthesis.resume(); // cancel() can wedge a paused engine
      speechSynthesis.cancel();
    }
    state.speechPaused = false;
  }

  // Logo click: end whatever is running and show the landing screen again.
  function goHome() {
    stopWatching();
    state.mode = "idle";
    dock.classList.add("hidden");
    toggleCollection(false);
    feed.querySelectorAll(".card").forEach((c) => c.remove());
    resetMap();
    hero.classList.remove("hidden");
    setStatus("Ready when you are!");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function endTour(statusText) {
    stopWatching();
    state.mode = "idle";
    dock.classList.add("hidden");
    setStatus(statusText);
    restartCard();
  }

  // ---------- directions ----------
  // Where is the landmark relative to the way we're walking?
  function relativeDirection(fromLat, fromLon, toLat, toLon) {
    if (state.heading == null || toLat == null) return null;
    const bearing = bearingDeg(fromLat, fromLon, toLat, toLon);
    const rel = ((bearing - state.heading + 540) % 360) - 180; // -180..180
    if (Math.abs(rel) <= 45) return { say: "Straight ahead", arrow: "⬆️" };
    if (rel > 45 && rel < 135) return { say: "On your right", arrow: "➡️" };
    if (rel < -45 && rel > -135) return { say: "On your left", arrow: "⬅️" };
    return { say: "Behind you", arrow: "↩️" };
  }

  function spokenIntro(direction, distance) {
    const dist = distance != null ? `about ${Math.round(distance / 10) * 10 || 10} meters away` : null;
    if (direction && dist) return `${direction.say}, ${dist}:`;
    if (dist) return `Just ${dist}:`;
    return "";
  }

  // ---------- geo math ----------
  function bearingDeg(lat1, lon1, lat2, lon2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
})();
