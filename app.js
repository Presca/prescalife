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
  const MAX_FACT_CHARS = 260;       // keep it short and impactful
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
  function factCard({ title, quip, fact, distance, url, image, emoji, direction }) {
    const el = document.createElement("article");
    el.className = "card";
    const inner = document.createElement("div");
    inner.className = "stamp-inner";
    el.appendChild(inner);

    const media = document.createElement("div");
    media.className = "card-media";
    media.textContent = emoji || "📍";
    inner.appendChild(media);

    const setImage = (src) => {
      if (!src) return;
      const img = document.createElement("img");
      img.alt = title;
      img.loading = "lazy";
      img.onload = () => { media.textContent = ""; media.appendChild(img); };
      img.src = src;
    };
    setImage(image);

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
    quipEl.textContent = quip;
    inner.appendChild(quipEl);

    const factEl = document.createElement("p");
    factEl.className = "card-fact";
    factEl.textContent = fact;
    inner.appendChild(factEl);

    if (url) {
      const link = document.createElement("a");
      link.className = "card-link";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Rabbit hole →";
      inner.appendChild(link);
    }

    feed.appendChild(el);
    el.scrollIntoView({ behavior: "smooth", block: "end" });
    speak(`${spokenIntro(direction, distance)} ${title}. ${fact}`.trim());
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
      const summary = await fetchSummary(hit.title);
      if (!summary) continue;
      factCard({
        title: summary.title,
        quip: nextQuip(),
        fact: summary.fact,
        distance: hit.dist,
        url: summary.url,
        image: summary.image,
        direction: relativeDirection(lat, lon, hit.lat, hit.lon),
      });
    }
    setDock(`${state.seen.size} spot${state.seen.size === 1 ? "" : "s"} covered. Onward!`, "🧭");
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
      emoji: "🗼",
      fact: "Gustave Eiffel kept a secret apartment at the top for entertaining guests like Thomas Edison. Paris's most exclusive flat, and the landlord never rented it out.",
      url: "https://en.wikipedia.org/wiki/Eiffel_Tower",
    },
    {
      title: "Colosseum",
      emoji: "🏟️",
      fact: "It could reportedly be flooded for mock naval battles. Romans invented the pool party, then made it a blood sport.",
      url: "https://en.wikipedia.org/wiki/Colosseum",
    },
    {
      title: "Big Ben",
      emoji: "🕰️",
      fact: "Big Ben is technically just the bell — the tower is the Elizabeth Tower. Correcting people about this is a beloved British pastime.",
      url: "https://en.wikipedia.org/wiki/Big_Ben",
    },
    {
      title: "Statue of Liberty",
      emoji: "🗽",
      fact: "She was delivered from France in 350 pieces packed in 214 crates — history's most stressful IKEA order.",
      url: "https://en.wikipedia.org/wiki/Statue_of_Liberty",
    },
    {
      title: "Great Pyramid of Giza",
      emoji: "🐫",
      fact: "It was the tallest human-made structure for about 3,800 years. The record now changes hands every decade; the pyramid is unbothered.",
      url: "https://en.wikipedia.org/wiki/Great_Pyramid_of_Giza",
    },
    {
      title: "Sydney Opera House",
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
