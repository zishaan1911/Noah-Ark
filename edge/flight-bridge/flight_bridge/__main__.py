"""python -m flight_bridge --broker broker:1883 --mav tcp:sim:5760 --drone ARK-006"""

from __future__ import annotations

import argparse

from .gateway import Gateway


def main() -> None:
    ap = argparse.ArgumentParser(description="Ark-1 flight bridge: MQTT <-> MAVLink")
    ap.add_argument("--broker", default="localhost:1883", help="MQTT host:port")
    ap.add_argument("--mav", default="tcp:127.0.0.1:5760", help="MAVLink connection string")
    ap.add_argument("--drone", required=True, help="drone id, e.g. ARK-006")
    a = ap.parse_args()
    Gateway(a.broker, a.mav, a.drone).run()


if __name__ == "__main__":
    main()
