# Edge (onboard companion computer)
- `perception/`: landing-surface classification (water/debris/ground), obstacle & recipient detection
- `offload-manager/`: decides onboard vs cloud execution based on link quality, battery, urgency
- `flight-bridge/`: MAVLink bridge between flight controller and AWS IoT Core / Greengrass
