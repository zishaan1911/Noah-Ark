# Hardware
Design, simulate, then build the physical Ark. Reference design: `../slipstream` (Gannet SX-01).

- `electronics/schematics/`: flight controller, companion computer, power, sensors, comms
- `electronics/pcb/`: PCB layouts
- `electronics/bom.md`: bill of materials
- `mechanical/`: airframe, waterproofing (IP rating), floats / hull for water landing

Key subsystems: flight controller (PX4/ArduPilot), companion computer (edge AI),
rain-tolerant sensing (radar/LiDAR + camera), comms (4G/LTE, LoRa, satellite fallback),
power (Li-ion pack + BMS), payload release / winch, buoyancy & sealing.
