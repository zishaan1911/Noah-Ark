# shortcut: reuses the sim image to save disk, build from the Jetson base image (L4T) for the real drone.
FROM noah-ark-sitl
RUN pip install --no-cache-dir paho-mqtt pydantic
WORKDIR /repo/edge/flight-bridge
ENV ARK_CONTRACTS_PATH=/repo/shared/generated/python
