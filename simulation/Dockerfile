# Ark-1 SITL: the official ArduCopter 4.7.2 SITL build plus the Python physics bridge.
# Build: docker build -t noah-ark-sitl simulation      Run: see simulation/README.md
FROM docker.io/library/python:3.12-slim
ADD --chmod=755 https://firmware.ardupilot.org/Copter/stable-4.7.2/SITL_x86_64_linux_gnu/arducopter /usr/local/bin/arducopter
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
WORKDIR /repo/simulation
