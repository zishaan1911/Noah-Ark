# Noah's Ark landing page

A one-page pitch for GDEX: a scroll-driven hero where ARK-001 lands on floodwater, then the concept, the drone and links to the apps (Ark Command, Ark SOS on PartyRock, Ark SOS for Android).
Plain HTML, CSS and JS: no framework, no build step.

## Run

```sh
python -m http.server 8000 --directory apps/landing   # then open http://localhost:8000
```
Opening `index.html` straight from disk also works, but the font preloads are blocked on `file://`.

## Links

Set the app links in the `LINKS` object at the top of the script in `index.html`. An empty link shows a disabled "Coming soon" button. In the nav, an empty Ark Command link falls back to `#apps`.

| Key | Now |
|---|---|
| `ARK_COMMAND_URL` | placeholder (Ark Command is not hosted yet) |
| `ARK_SOS_PARTYROCK_URL` | the PartyRock app from `partyrock/noah-ark-dispatch.md` |
| `ARK_SOS_APK_URL` | placeholder (no APK release yet) |

## The hero frames

`assets/ark/` holds 97 transparent WebP frames (1280×720, plus 640×360 in `sm/` for small screens) and `frames.js`, which gives the waterline and SITL altitude for each frame. They are rendered from the Ark-1 viewer's ArduCopter SITL water landing:

```sh
python hardware/industrial-design/build_viewer.py      # if the drone changed
python apps/landing/scripts/render_frames.py           # all frames, ~2 min (Edge + Playwright)
python apps/landing/scripts/render_frames.py 0 60 96   # just these, for checking
```
The camera schedule is `KEYS` in the script. The water plane is rendered depth-only, so it hides the submerged parts of the pontoons, and the page draws the water as a CSS band.

`?rec=1` switches to recorder mode: `window.__recTime(t)` for t in 0–11 s scrolls the page to a fixed point and returns the frame index, which makes frame-by-frame video capture deterministic.

## Test

No unit tests; it's a static page. To check it, serve it, scroll the hero at 1440×960 and 390×844, and confirm:
- no horizontal scroll;
- "THE ARK DELIVERS" stays behind the drone;
- every link opens or shows "Coming soon".
