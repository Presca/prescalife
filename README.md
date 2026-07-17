# presca.life ☁️✦

**Presca's portfolio — a day in Presca's sky.**

One continuous scroll from a soft morning sky to a starry night. Built with
vanilla HTML/CSS/JS, [GSAP](https://gsap.com) (ScrollTrigger) and
[Three.js](https://threejs.org) — no build step, no framework. Open
`index.html` on any static host and it just works.

## The concept

The site is themed as one day, and each moment of the day carries a part of
the story:

| Time of day | Section | What it tells |
|---|---|---|
| ☁️ Morning sky | **Hero** | Name, rotating roles, drifting Three.js clouds (click the sky to make cloud puffs) |
| 👁 Noon | **I observe. I ponder. I create.** | The observer's mindset — the eye follows your cursor and blinks |
| 🌊 Afternoon | **The river so far** | Career journey as a river that draws itself as you scroll |
| 🌸 Dusk | **A garden of craft** | Skills as flowers that bloom into view + the AI workflow |
| ✨ Night | **Constellations** | Projects as constellations — hover to connect the stars |
| 🌠 Deep night | **Make a wish** | Contact, with shooting stars on click |

Playful extras: a generative ambient music box (the "sound" toggle — soft
pentatonic chimes, no audio files), cursor sparkles, four hidden "little
wonders" (the small ✦ marks) to collect, and a found-counter in the footer.

## Editing your content

Everything editable lives in two files:

- **`index.html`** — all copy. Search for `✏️ PRESCA` comments:
  - the four **project cards** in `#work` are placeholders (Lumen, Riverline,
    Petal, Nightlight) — swap in your real case studies and links
  - the **social links** in `#contact` point at `#` — add your profiles
- **`js/main.js`**:
  - `roles` array — the rotating "i am a …" lines in the hero
  - `skills` array — the garden flowers (label, petal count, colors)
  - the `wonders` are defined by `data-wonder="…"` attributes in the HTML

## Running locally

Any static server works:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

## Notes

- GSAP and Three.js are vendored in `js/vendor/` — the site is fully
  self-contained except for Google Fonts (Fraunces + Outfit).
- Respects `prefers-reduced-motion`, works on touch devices (fewer
  particles, constellations draw on scroll instead of hover), and has no
  horizontal overflow on small screens.
