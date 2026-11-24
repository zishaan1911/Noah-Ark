"""HTTP routes of the local SOS API (openapi.yaml: /sos, /sos/{sosId}, /sos/{sosId}/report, /sos/{sosId}/location)."""

import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .mqtt_link import Publisher
from .store import CLOSED, LOCATION_UPDATE, REPORT, SosStore

# The triage Lambda lives beside the other functions; the local API calls it in-process.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "functions" / "sos-triage"))
from handler import triage

MAX_BODY = 64 * 1024
SOS_PATH = re.compile(r"^/v1/sos/(?P<id>[^/]+)(?P<sub>/report|/location)?$")


def make_server(store: SosStore, publisher: Publisher, port: int = 8080, host: str = "0.0.0.0") -> ThreadingHTTPServer:
    """A server bound to `host:port` (port 0 picks a free one); the caller runs `serve_forever`."""

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args) -> None:  # keep the demo console quiet
            return

        def _send(self, code: int, body: dict | None = None) -> None:
            data = json.dumps(body).encode() if body is not None else b""
            self.send_response(code)
            self.send_header("Access-Control-Allow-Origin", "*")
            if body is not None:
                self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _error(self, code: int, message: str) -> None:
            self._send(code, {"message": message})

        def _body(self) -> dict | None:
            """The JSON object body, or None after sending a 400."""
            try:
                length = int(self.headers.get("Content-Length", 0))
                if not 0 < length <= MAX_BODY:
                    raise ValueError("body missing or too large")
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError("body must be a JSON object")  # noqa: TRY004 - answered as a 400 below
                return body
            except ValueError as e:
                self._error(400, str(e))
                return None

        def _valid(self, validator, body: dict) -> bool:
            errors = list(validator.iter_errors(body))
            if errors:
                where = "/".join(str(p) for p in errors[0].absolute_path)
                self._error(400, f"{where + ': ' if where else ''}{errors[0].message}")
            return not errors

        def _publish(self, sos: dict) -> None:
            publisher.publish(sos)
            if sos["status"] in CLOSED:
                publisher.publish(sos)

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self) -> None:
            if self.path == "/v1/health":
                return self._send(200, {"ok": True})
            m = SOS_PATH.match(self.path)
            if not m or m["sub"]:
                return self._error(404, "not found")
            sos = store.get(m["id"])
            self._send(200, sos) if sos else self._error(404, "SOS not found")

        def do_POST(self) -> None:
            if self.path == "/v1/sos":
                return self._create()
            m = SOS_PATH.match(self.path)
            if m and m["sub"] == "/location":
                return self._location(m["id"])
            self._error(404, "not found")

        def do_PUT(self) -> None:
            m = SOS_PATH.match(self.path)
            if m and m["sub"] == "/report":
                return self._replace_report(m["id"])
            self._error(404, "not found")

        def _create(self) -> None:
            report = self._body()
            if report is None or not self._valid(REPORT, report):
                return
            sos = store.create(report)
            result, _path = triage(report)
            sos = store.update(sos["id"], triage=result, status="triaged")
            self._publish(sos)
            self._send(201, sos)

        def _replace_report(self, sos_id: str) -> None:
            report = self._body()
            if report is None or not self._valid(REPORT, report):
                return
            current = store.get(sos_id)
            if current is None:
                return self._error(404, "SOS not found")
            if current["status"] in CLOSED:
                return self._error(409, f"SOS is {current['status']}")
            result, _path = triage(report)
            status = "triaged" if current["status"] == "new" else current["status"]
            sos = store.update(sos_id, report=report, triage=result, status=status)
            self._publish(sos)
            self._send(200, sos)

        def _location(self, sos_id: str) -> None:
            update = self._body()
            if update is None or not self._valid(LOCATION_UPDATE, update):
                return
            current = store.get(sos_id)
            if current is None:
                return self._error(404, "SOS not found")
            if current["status"] in CLOSED:
                return self._error(409, f"SOS is {current['status']}")
            self._publish(store.update_location(sos_id, update))
            self._send(204)

    return ThreadingHTTPServer((host, port), Handler)
