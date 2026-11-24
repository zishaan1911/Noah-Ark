"""python -m local_api --broker broker:1883 --port 8080   (--broker "" runs without MQTT)"""

import argparse

from .mqtt_link import MqttPublisher, NoPublisher
from .server import make_server
from .store import SosStore


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--broker", default="localhost:1883", help='host:port; "" runs without MQTT')
    ap.add_argument("--port", type=int, default=8080)
    a = ap.parse_args()
    store = SosStore()
    publisher = MqttPublisher(a.broker, store) if a.broker else NoPublisher()
    server = make_server(store, publisher, a.port)
    print(f"sos-api: listening on :{a.port}, broker {a.broker or 'none'}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
