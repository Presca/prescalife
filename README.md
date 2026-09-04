# 🗺️ Tour Guide Buddy

A live tour guide in your pocket. Start a tour, walk around, and when you pass
somewhere iconic it pipes up with **one** short, witty, true fact — then shuts
up until the next landmark. No blabbing, no umbrella, no tip jar.

## How it works

- **Live tour** — uses the browser Geolocation API to watch your position.
  Every ~25 m of movement it asks Wikipedia's free
  [GeoSearch API](https://www.mediawiki.org/wiki/Extension:GeoData) what's
  within 250 m, picks the most notable unseen spots, trims the fact to one
  punchy paragraph, and drops it in your feed. Works anywhere Wikipedia has
  coordinates — which is basically everywhere.
- **Couch demo** — a simulated stroll past six world icons, so you can try the
  experience without leaving the sofa (or granting location access).
- **Live map** — a sticky map (Leaflet + OpenStreetMap, vendored, no keys)
  shows where you are 🚶 and where each announced place is 📍, with a dashed
  line to the newest one so "200 m on your left" means something.
- **Read aloud** — facts are spoken by default via the browser's speech
  synthesis (best natural voice auto-picked); pause/resume from the dock,
  mute with 🔇/🔊.
- **Snap & collect** — tap "📸 I was here!" on any card to take a photo:
  it replaces the place's picture and saves the spot to your 📚 collection
  (stored locally in your browser, no account needed).
- Each place is announced **once per tour**, at most two per scan.

## Privacy

Your location stays on-device. The only network calls are to Wikipedia's
public API to find nearby places. Nothing is stored or sent anywhere else.

## Running it

It's a static site — no build step, no dependencies.

```bash
# any static server works
python3 -m http.server 8080
# then open http://localhost:8080
```

Or enable **GitHub Pages** on this repo (Settings → Pages → deploy from
branch) and open it on your phone. Note: browsers only allow geolocation on
`https://` or `localhost`, so Pages is the easiest way to use live mode.

## Stack

Plain HTML, CSS, and JavaScript. That's it. The whole guide fits in three
files and one personality.
