# Bill of Materials (Ark-1)
From `../ark.json` (`chosen`, `mechanical_design`); rerun the scripts in `../README.md` after changing inputs.
Avionics rows are candidates with the mass budget used in sizing.

| Subsystem | Part | Qty | Mass (kg) | Notes |
|---|---|---|---|---|
| Propulsion | 8108-class 120 KV brushless motor | 4 | 0.36 ea | 12S, open frame (rain-tolerant) |
| Propulsion | 26x8.5" carbon prop | 4 | 0.07 ea | 0.66 m disk |
| Propulsion | 12S 80 A ESC | 4 | 0.11 ea | In the hull at each arm socket, potted |
| Power | 12S6P Li-ion pack, 21700 5 Ah (50S-class) | 1 | 5.71 | 1.30 kWh, 150 A limit; cells upright, 0.265 x 0.136 x 0.079 m with BMS + case; load cutoff 2.8 V/cell |
| Flight controller | Pixhawk-class FC + dual GNSS | 1 | 0.15 | ArduPilot; GNSS sees the sky through the glass-fibre lid |
| Companion computer | Jetson Orin Nano-class | 1 | 0.20 | Edge AI, offload manager, Greengrass |
| Comms | 4G/LTE modem + LoRa + satellite messenger | 1 set | 0.12 | Link fallback chain |
| Sensors | mmWave radar + downward LiDAR + camera | 1 set | 0.30 | Nose; rain-tolerant sensing, water-landing check |
| Payload | IP67 metal-gear servo (25 kg cm) + release hook | 1 | 0.25 | Holds the 2 kg drop pod (0.25 x 0.16 x 0.10 m); release SF 21 |
| Wiring | PDB, bulk capacitors, harness, connectors | 1 | 0.35 | |
| Hull | Glass-fibre ellipsoid clamshell, 0.58 x 0.40 x 0.23 m | 1 | 1.24 | 2.5 kg/m^2; RF-transparent for GNSS/LTE |
| Hull | 3.53 mm nitrile O-ring, 1.50 m, + 25 M4 stainless bolts | 1 set | 0.20 | Face-seal gland 2.65 x 4.93 mm in the equator flange; IP67 (1 m) |
| Hull | Cable glands M16 IP68 (motor leads) + M12 IP68 (servo lead) | 4 + 1 | incl. | |
| Frame | Flange ring + 4 arm sockets | 1 | 0.15 | Arms bolt into the clamshell flange |
| Frame | 38 x 1 mm carbon arm tube | 4 | 0.11 ea | 0.51 m arm radius, 0.28 m free; 96 Hz first mode |
| Frame | Motor pylon (0.26 m) + mount | 4 | 0.08 ea | Keeps props 0.26 m above the water when floating loaded |
| Landing gear | 15 mm carbon skids + struts | 1 set | 0.30 | Clear the payload pod by 30 mm |
