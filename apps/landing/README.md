# GDEX × Noah's Ark landing page

A one-page pitch for GDEX, in plain HTML, CSS and JS: no framework, no build step.

1. **Freight hero:** a reach stacker loads a GDEX container onto a truck. The clip is scrubbed by scroll. "OUR SERVICES" then slides behind the truck while the services strip slides in.
2. **Jungle last mile:** ARK-001 flies a GDEX parcel 20 km over the rainforest, drops it at a longhouse village and flies home.
3. How it works, the drone (specs and gallery), and the apps (Ark Command, Ark SOS on PartyRock, Ark SOS for Android).

## Run

```sh
python -m http.server 8000 --directory apps/landing   # then open http://localhost:8000
```
The hero clip streams from CloudFront, so the page needs a network connection.

## Links

Set the app links in the `LINKS` object at the top of the script in `index.html`. An empty link shows a disabled "Coming soon" button. In the nav, an empty Ark Command link falls back to `#apps`.

| Key | Now |
|---|---|
| `ARK_COMMAND_URL` | placeholder (Ark Command is not hosted yet) |
| `ARK_SOS_PARTYROCK_URL` | the PartyRock app from `partyrock/noah-ark-dispatch.md` |
| `ARK_SOS_APK_URL` | placeholder (no APK release yet) |

## Assets and how they're made

| Asset | Made by |
|---|---|
| `assets/hero/container.js` | `scripts/track_container.py <clip-1080.mp4>`: the container's side for each clip frame, so the GDEX decal rides on it |
| `assets/jungle/ark-*.webp` | `scripts/render_drone.py`: ARK-001 in four poses from the drone viewer. It prints the pod box used for the parcel drop (`POD` in `index.html`) |
| `assets/brand/gdex-logo.png` | copied from `hardware/industrial-design/livery/` (see `SOURCES.md` there) |
| `assets/renders/` | the stills in `hardware/industrial-design/out/renders/final/`, as WebP |

The jungle itself (ridges, canopy, river, longhouse) is SVG generated in the page, so it fits any screen size.

`?rec=1` switches to recorder mode: `window.__recTime(video, t)` for t in 0–11 s scrolls the hero to a fixed point and returns the clip time, which makes frame-by-frame video capture deterministic.

## Test

No unit tests; it's a static page. To check it, serve it, scroll at 1440×960 and 390×844, and confirm:
- the decal stays on the container;
- "OUR SERVICES" never shows through the truck;
- the drone and the copy never overlap;
- there's no horizontal scroll;
- every link opens or shows "Coming soon".
