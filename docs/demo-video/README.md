# Demo video

Records the Noah's Ark demo video: Chrome full screen on the desktop, ffmpeg grabbing the screen, and an injected overlay
(`overlay.js`) drawing captions, highlight rings and a cursor. One clip per segment, then `assemble.py` joins them with
crossfades, per-part speed-ups and music. The 6:37 submission cut is the scored version (B1 below).

## Needs
Linux on X11, Google Chrome, ffmpeg, Node 22, `npm i playwright-core@1.49.1` here, the local stack (`./demo.sh`),
the landing page on :8000, `stage/` served on :8099, and the Android emulator for the phone segments (`nix develop .#mobile`).
- `stage/ml/`: copy `maplibre-gl.{css,mjs}`, `maplibre-gl-shared.mjs`, `maplibre-gl-worker.mjs` from
  `apps/operator-dashboard/node_modules/maplibre-gl/dist/`.
- `stage/ark_viewer.html`: `python hardware/industrial-design/build_viewer.py --out docs/demo-video/stage/ark_viewer.html`.
- PartyRock: a Chrome profile signed in to PartyRock, in `.chrome-profile/` or `PROFILE=<dir>`.
- `music/`: the tracks named in the commands below (NCS, ncs.io; "Inspired", Kevin MacLeod, CC BY 4.0). Not committed.

## Record
```bash
node record.mjs intro landing partyrock phone android fleet phone2 gdex defence drone outro
```
- Turn off screen blanking first (`gsettings set org.gnome.desktop.session idle-delay 0`, restore to 300 after).
- `gdex` flies the whole delivery in real time (about 15 min) and writes `clips/07-gdex.json` for the time-lapse cut.
  ARK-006 must start at the Papar hub. Add `landed` and `end` (seconds) to that file after checking the clip.
- `defence` needs ARK-006 at MAIN BASE: publish `sim/ARK-006/spawn {"lat":5.03,"lon":118.33}` and restart the gateway.
- `outro` takes `OUTRO=<clip name>` and `CREDIT=<music credit HTML>`.

## Assemble
```bash
python assemble.py out.mp4 10-outro-b1 \
  "01=ncs/backtoyou.mp3,02=ncs/dreamer.mp3@drop,03=ncs/memory.mp3,05=ncs/skyhigh.mp3@drop,08=ncs/royalty.mp3@80,09=ncs/eheaven.mp3@drop"
```
A single track works too: `python assemble.py out.mp4 10-outro inspired.mp3`. Audio is normalised to -16 LUFS.
`bgm.py` writes an original ambient track if no music is to hand.

shortcut: segment timings and click targets are tied to today's UI; re-check them with a contact sheet after UI changes.
