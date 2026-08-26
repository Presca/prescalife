/* Tour Guide Buddy — a live, location-aware tour guide with jokes.
 *
 * Live mode: watches your position, asks Wikipedia's geosearch API for
 * notable places within earshot, and announces each one exactly once with
 * a short quip + one trimmed fact. Demo mode: a simulated stroll past
 * world icons, no GPS or network needed.
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
    seen: new Set(),        // page titles already announced this tour
    voiceOn: false,
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
  $("stop-btn").addEventListener("click", () => endTour("Tour over. My imaginary umbrella is lowered. 🌂"));
  $("voice-toggle").addEventListener("click", toggleVoice);

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

  function systemCard(text) {
    const el = document.createElement("div");
    el.className = "card system";
    el.textContent = text;
    feed.appendChild(el);
    el.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  function factCard({ title, quip, fact, distance, url }) {
    const el = document.createElement("article");
    el.className = "card";

    const top = document.createElement("div");
    top.className = "card-top";
    const place = document.createElement("h3");
    place.className = "card-place";
    place.textContent = title;
    top.appendChild(place);
    if (distance != null) {
      const dist = document.createElement("span");
      dist.className = "card-dist";
      dist.textContent = `~${Math.round(distance)} m away`;
      top.appendChild(dist);
    }
    el.appendChild(top);

    const quipEl = document.createElement("p");
    quipEl.className = "card-quip";
    quipEl.textContent = quip;
    el.appendChild(quipEl);

    const factEl = document.createElement("p");
    factEl.className = "card-fact";
    factEl.textContent = fact;
    el.appendChild(factEl);

    if (url) {
      const link = document.createElement("a");
      link.className = "card-link";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Rabbit hole →";
      el.appendChild(link);
    }

    feed.appendChild(el);
    el.scrollIntoView({ behavior: "smooth", block: "end" });
    speak(`${title}. ${fact}`);
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
  function toggleVoice() {
    state.voiceOn = !state.voiceOn;
    const btn = $("voice-toggle");
    btn.setAttribute("aria-pressed", String(state.voiceOn));
    btn.textContent = state.voiceOn ? "🔊" : "🔇";
    if (!state.voiceOn && "speechSynthesis" in window) speechSynthesis.cancel();
  }

  function speak(text) {
    if (!state.voiceOn || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    speechSynthesis.speak(u);
  }

  // ---------- live tour ----------
  function startLiveTour() {
    if (!("geolocation" in navigator)) {
      systemCard("No geolocation on this device. Try the couch demo — zero walking required.");
      return;
    }
    resetTour("live");
    showTouring("On duty. Wander freely.");
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
    endTour("Off duty. Tap start and let's wander.");
  }

  function onPosition(pos) {
    const { latitude: lat, longitude: lon } = pos.coords;
    const now = Date.now();
    const { lastScan } = state;

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
      };
    } catch {
      return null;
    }
  }

  // ---------- demo tour ----------
  const DEMO_STOPS = [
    {
      title: "Eiffel Tower",
      fact: "Gustave Eiffel kept a secret apartment at the top for entertaining guests like Thomas Edison. Paris's most exclusive flat, and the landlord never rented it out.",
      url: "https://en.wikipedia.org/wiki/Eiffel_Tower",
    },
    {
      title: "Colosseum",
      fact: "It could reportedly be flooded for mock naval battles. Romans invented the pool party, then made it a blood sport.",
      url: "https://en.wikipedia.org/wiki/Colosseum",
    },
    {
      title: "Big Ben",
      fact: "Big Ben is technically just the bell — the tower is the Elizabeth Tower. Correcting people about this is a beloved British pastime.",
      url: "https://en.wikipedia.org/wiki/Big_Ben",
    },
    {
      title: "Statue of Liberty",
      fact: "She was delivered from France in 350 pieces packed in 214 crates — history's most stressful IKEA order.",
      url: "https://en.wikipedia.org/wiki/Statue_of_Liberty",
    },
    {
      title: "Great Pyramid of Giza",
      fact: "It was the tallest human-made structure for about 3,800 years. The record now changes hands every decade; the pyramid is unbothered.",
      url: "https://en.wikipedia.org/wiki/Great_Pyramid_of_Giza",
    },
    {
      title: "Sydney Opera House",
      fact: "Budgeted at 7 million dollars, it landed at 102 million and ten years late — proof that every great project estimate is a work of fiction.",
      url: "https://en.wikipedia.org/wiki/Sydney_Opera_House",
    },
  ];

  function startDemoTour() {
    resetTour("demo");
    showTouring("Couch demo. Zero steps required.");
    setDock("Simulating a very glamorous stroll…", "🛋️");
    systemCard("Demo tour: pretend we're power-walking past the world's greatest hits. 🌍");

    let i = 0;
    const step = () => {
      if (state.mode !== "demo") return;
      if (i >= DEMO_STOPS.length) {
        systemCard("Demo complete. Now go outside and try it for real — I'll be here. 🌤️");
        endTour("Off duty. Tap start and let's wander.");
        return;
      }
      const stop = DEMO_STOPS[i++];
      factCard({
        ...stop,
        quip: nextQuip(),
        distance: 40 + Math.floor(Math.random() * 160),
      });
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
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  function endTour(statusText) {
    stopWatching();
    state.mode = "idle";
    dock.classList.add("hidden");
    setStatus(statusText);
  }

  // ---------- geo math ----------
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
