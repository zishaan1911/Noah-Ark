# Bill of materials: Ark-1 electrical system

Source of truth: `../industrial-design/harness.json` (every part, port and wire, with positions and routes), checked by
`../industrial-design/harness.py` (netlist, wire gauge vs current, connector ratings, fit inside the shell). The
airframe, props and pontoon fabric are outside this list. Masses marked *est.* are not published by the maker.

## Power
| Part | Qty | Mass | Source | Notes |
|---|---|---|---|---|
| Samsung INR21700-50S cell (5.0 Ah, 21.4 x 70.5 mm) | 48 | 3.81 kg pack | [datasheet](https://www.samsungsdi.com/upload/download/product/INR21700-50S.pdf) | 12S4P, 864 Wh, upright in printed holders, 0.15 x 8 mm nickel strip, two Velcro straps |
| JBD SP16S020 smart BMS (set to 12S, 100 A, isolated UART) | 1 | 95 g *est.* | [spec](https://cdn.shopify.com/s/files/1/0606/5199/5298/files/JBD-SP16S020.pdf) | Low-side; 13 balance taps (22 AWG), 2 NTC; UART to the Jetson |
| AMASS XT90-S anti-spark connector pair | 1 | 18 g | [AMASS spec](https://www.china-amass.net/uploads/XT90-2+2-F-SPEC.pdf) | Arming plug behind the rear hatch; 45 A rated, 90 A peak |
| Holybro PM02D HV power module (2-12S, INA228, I2C) | 1 | 20 g | [Holybro](https://holybro.com/products/pm02d-power-module) | 60 A continuous / 100 A < 60 s; XT60s replaced by 8 AWG; 5.2 V 3 A to POWER1 |
| Panasonic EEU-FS1J471 (470 uF, 63 V, 16 x 25 mm) | 4 | 36 g *est.* | [Panasonic](https://industrial.panasonic.com/ww/products/pt/aluminum-cap-lead/models/EEUFS1J471) | 1.88 mF bulk bank (SPICE model: 2 mF) |
| Matek FCHUB-12S V2 PDB (4 x 70 A, 5.1 V 5 A + 12 V 4 A BECs) | 1 | 21 g | [Mateksys](https://www.mateksys.com/?portfolio=fchub-12s) | 5.1 V to the servo rail, 12 V to the firing driver |
| Matek BEC12S-PRO (9-55 V in, 5 A) | 2 | 10 g | [Mateksys](https://www.mateksys.com/?portfolio=bec12s-pro) | One at 12 V for the Jetson, one at 5.2 V into the Pixhawk's POWER2 (backup) |

## Propulsion
| Part | Qty | Mass | Source | Notes |
|---|---|---|---|---|
| T-Motor ALPHA 80A 12S ESC | 4 | 440 g | [T-Motor](https://uav-en.tmotor.com/Multirotor/ESC/alpha) | In the arm roots; 12 AWG feed with XT60H, JR signal plug (PWM, GND, telemetry) |
| T-Motor MN801-S KV120 | 4 | 1.88 kg | [T-Motor](https://store.tmotor.com/product/mn801-s-kv120-motor-navigator-type.html) | Phase leads extended in the arm with 14 AWG and 4.0 mm gold bullets |

## Avionics and links
| Part | Qty | Mass | Source | Notes |
|---|---|---|---|---|
| Holybro Pixhawk 6X, standard baseboard v2B | 1 | 74 g | [pinout](https://docs.holybro.com/autopilot/pixhawk-6x/pixhawk-baseboard-pinout) | ArduPilot; 4 isolators on 20 mm nylon standoffs above the PDB |
| NVIDIA Jetson Orin Nano 8GB Developer Kit + NVMe SSD | 1 | 176 g | [NVIDIA](https://developer.nvidia.com/embedded/learn/jetson-orin-nano-devkit-user-guide/hardware_spec.html) | 12 V into the 9-20 V barrel jack; Ethernet to the 6X; Wi-Fi card removed |
| Holybro M10 GPS (GNSS, compass, safety switch, buzzer) | 1 | 33 g | [Holybro](https://holybro.com/products/m10-gps) | On the mast; 10-pin GH to GPS1 |
| Ainstein US-D1 radar altimeter | 1 | 110 g | [PX4 docs](https://docs.px4.io/main/en/sensor/ulanding_radar) | Under the belly; UART on TELEM3 |
| RFDesign RFD900x + 2 x 900 MHz dipoles | 1 | 15 g + 24 g *est.* | [datasheet](https://files.rfdesign.com.au/Files/documents/RFD900x%20DataSheet%20V1.2.pdf) | TELEM1; RG316 pigtails to two RP-SMA bulkheads under the shelf |
| Ground Control RockBLOCK 9603 (SMA variant) | 1 | 36 g | [Ground Control](https://docs.groundcontrol.com/iot/rockblock/specification/dimensions) | TELEM2 (ArduPilot rockblock.lua) |
| Maxtena M1621HCT-P-SMA Iridium antenna | 1 | 28 g *est.* | [Maxtena](https://maxtena.com/products/m1621hct-p-sma/) | Roof, 16 cm from the GNSS antenna |
| Quectel EG25-G mini PCIe + mPCIe-to-USB adapter (nano-SIM) | 1 | 25 g *est.* | [Quectel](https://quectel.com/content/uploads/2024/03/Quectel_EG25-G_Mini_PCIe_LTE_Standard_Specification_V1.7-1-1.pdf) | USB to the Jetson; adapter model chosen at purchase |
| Taoglas FXUB63 flexible LTE antenna | 2 | 6 g | [Taoglas](https://www.taoglas.com/product/fxub63-ultra-wide-band-flex-antenna/) | Main + diversity, inside the RF-transparent shell |
| FrSky R-XSR receiver (SBUS) | 1 | 1.5 g | [FrSky](https://www.frsky-rc.com/product/r-xsr/) | Manual override; RC IN; antennas at 90 degrees inside the shell |
| FTDI FT4232H-56Q Mini Module | 1 | 8 g *est.* | [FTDI](https://ftdichip.com/products/ft4232h-56q-mini-md/) | ESC telemetry (4 UARTs) into the Jetson |

## Pontoon, cargo and lights
| Part | Qty | Mass | Source | Notes |
|---|---|---|---|---|
| Ark firing driver: 3 x Infineon IRLML6344 (ARM in series with FIRE L/R) | 1 | 6 g *est.* | [Infineon](https://www.infineon.com/cms/en/product/power/mosfet/n-channel/irlml6344/) | In-house PCB; AUX3 ARM, AUX4/5 FIRE; 12 V into 0.5 A x 300 ms latch solenoids |
| Multicomp PSF102 pressure switch (N.O., 12 kPa) | 2 | in pontoon kit | pontoon system | AUX6/AUX7 inputs, 10 k pull-ups to 3.3 V |
| Cargo connector: IP67 micro servo latch + 4 pogo contacts | 1 | 120 g *est.* | in-house | AUX1 servo; contacts carry CAN2 (DroneCAN smart pod) |
| Adafruit NeoPixel Mini Button PCB (WS2812B) | 5 | 2.5 g | [Adafruit 1612](https://www.adafruit.com/product/1612) | Status (rear hatch) + 4 nav lights behind arm-floor windows, chained on AUX8 |

## Wiring and hardware
| Item | Qty | Notes |
|---|---|---|
| 8 AWG silicone, red/black | 0.61 m | Pack, arming plug, PM, PDB (27 A continuous, 75 A peak) |
| 12 AWG silicone, red/black | 1.39 m | ESC feeds and the capacitor pair |
| 14 AWG silicone, black | 2.63 m | Motor phase extensions |
| 18-22 AWG silicone pairs | 1.91 m | Jetson 12 V, BEC feeds, firing leads, servo rail |
| 24-28 AWG (JST-GH / servo / LED / signal cables) | 10.9 m | 26/28 AWG multi-conductor leads |
| RG316 coax (SMA/RP-SMA) | 0.73 m | RFD900x, Iridium |
| 1.13 mm micro-coax (U.FL/IPEX) | 0.57 m | LTE, R-XSR |
| Connectors | as netlisted | XT90-S, 4 x XT60H, 24 x 4.0 mm bullets, JST-GH 3/4/6/10-pin, CLIK-Mate 6-pin, JST-PH/XH, PicoBlade, 2-pin Deutsch DTM (pontoons) |
| IP68 cable glands | 2 x M12, 2 x M8 + mast gland | Belly (radar, cargo), front legs (inflator leads) |
| SMA / RP-SMA bulkheads | 3 | Roof (Iridium), shelf underside (RFD900x) |
| 2 mm carbon deck + 1.5 mm carbon tray | 1 + 1 | Deck on four shelf bosses; tray on four 34 mm aluminium standoffs |
| M3 nylon standoffs 20 mm, rubber isolators, brass standoffs, Dual Lock pads, 2.5 mm cable ties, heatshrink | set | Mounting and dressing |

Totals from `harness.json` checks: 51 components, 166 ports, 75 wires (166 conductors), 18.7 m of wire, 0.19 kg of
copper, longest run 1.0 m (right pontoon pressure lead). Electrical parts drawn in the hub weigh 4.9 kg including the
3.8 kg pack.
