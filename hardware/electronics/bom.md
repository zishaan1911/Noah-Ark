# Bill of Materials (Ark-1)
Propulsion, power and hull come from `../ark.json` (`chosen`); rerun `sizing/size_ark.py` after changing them.
Avionics rows are candidates with the mass budget used in sizing.

| Subsystem | Part | Qty | Mass (kg) | Notes |
|---|---|---|---|---|
| Propulsion | 8108-class 120 KV brushless motor | 4 | 0.36 ea | 12S, open frame (rain-tolerant) |
| Propulsion | 26x8.5" carbon prop | 4 | 0.07 ea | 0.66 m disk |
| Propulsion | 12S 80 A ESC | 4 | 0.11 ea | Inside arm root, potted |
| Power | 12S6P Li-ion pack, 21700 5 Ah (50S-class) | 1 | 5.71 | 1.30 kWh, 25 A/cell, 150 A pack limit; includes BMS + case |
| Flight controller | Pixhawk-class FC + dual GNSS | 1 | 0.15 | ArduPilot |
| Companion computer | Jetson Orin Nano-class | 1 | 0.20 | Edge AI, offload manager, Greengrass |
| Comms | 4G/LTE modem + LoRa + satellite messenger | 1 set | 0.12 | Link fallback chain |
| Sensors | mmWave radar + downward LiDAR + camera | 1 set | 0.30 | Rain-tolerant sensing, water-landing check |
| Payload | Release latch / bay door | 1 | 0.25 | 2 kg payload in a bay in the hull |
| Wiring | PDB, harness, connectors | 1 | 0.35 | |
| Hull | Sealed ellipsoid shell, 0.56 x 0.39 x 0.23 m | 1 | 1.20 | Composite, 2.5 kg/m^2; IP67 |
| Hull | Hatch + seals | 1 | 0.20 | |
| Frame | 30 mm carbon arm tubes + motor mounts and pylons | 4 | 0.13 ea | 0.51 m arm radius, 0.15 m pylons |
