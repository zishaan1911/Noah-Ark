# Part models

Third-party 3D models used by the viewer (`viewer/20_electronics.js`). `../fetch_parts.py` downloads them from Sketchfab
(it reads `SKETCHFAB_API_TOKEN` from the repo-root `.env`), re-centres and rotates them into the drone frame
(x forward, y left, z up), and scales them to the real part's size. Everything else in the electronics bay is modelled
procedurally from datasheet dimensions.

| File | Used for | Source | Author | Licence | Changes |
|---|---|---|---|---|---|
| `antenna_sma_90.glb` | RFD900x 900 MHz dipoles (2x, under the shelf) | [433mhz Antenna (90° SMA male connector)](https://sketchfab.com/3d-models/433mhz-antenna-90-sma-male-connector-b1772b0f280d4f2888541e69ae12475f) | [astoria_cansat](https://sketchfab.com/astoria_cansat) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | Rotated into the drone frame; the whip stretched to 105 mm and the body scaled to 18.8 x 10 mm (estimated size of RFDesign's dipole) |

Searched with no usable result (no model, wrong product, or a licence that doesn't allow reuse): Pixhawk / flight
controller, Jetson / Jetson Orin, XT90, XT60, JST connector, ESC, power distribution board, 21700 cell, servo, heatsink,
40 mm fan, DC-DC converter, GPS module, LTE modem, RJ45, bullet connector, cable tie. An M.2 SSD model (Samsung 990 Pro,
CC BY) exists but was dropped: it sits under the Jetson carrier, out of sight, and its textures cost 2.5 MB.
