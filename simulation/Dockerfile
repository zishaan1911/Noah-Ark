# Ark-1 SITL: ArduCopter 4.7.2 SITL plus the Python physics bridge.
# Build: docker build -t noah-ark-sitl simulation      Run: see simulation/README.md
# amd64 downloads the official SITL binary; arm64 (e.g. Oracle Cloud's free Ampere VM) has none, so it builds the same tag from source (~20 min, once).
ARG TARGETARCH

FROM python:3.12-slim AS sitl-amd64
ADD --chmod=755 https://firmware.ardupilot.org/Copter/stable-4.7.2/SITL_x86_64_linux_gnu/arducopter /arducopter

FROM python:3.12-slim AS sitl-arm64
RUN apt-get update && apt-get install -y --no-install-recommends git g++ make && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir empy==3.3.4 future pexpect lxml
RUN git clone --depth 1 --branch Copter-4.7.2 --recurse-submodules --shallow-submodules \
    https://github.com/ArduPilot/ardupilot.git /ardupilot
WORKDIR /ardupilot
RUN ./waf configure --board sitl --static && ./waf copter && cp build/sitl/bin/arducopter /arducopter

FROM sitl-${TARGETARCH} AS sitl

FROM python:3.12-slim
COPY --from=sitl /arducopter /usr/local/bin/arducopter
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
WORKDIR /repo/simulation
