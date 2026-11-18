"""Lambda entry: assign available drones to open orders."""

from __future__ import annotations

from typing import Any

from bedrock import explain_with_bedrock
from optimiser import DroneState, Order, assign


def _num(d: dict[str, Any], key: str, where: str) -> float:
    v = d.get(key)
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ValueError(f"{where}: '{key}' is missing or not a number")  # noqa: TRY004  (one error type for any bad field: the API maps it to 400)
    return float(v)


def _str(d: dict[str, Any], key: str, where: str) -> str:
    v = d.get(key)
    if not isinstance(v, str) or not v:
        raise ValueError(f"{where}: '{key}' is missing or not a string")
    return v


def _obj(v: Any, where: str) -> dict[str, Any]:
    if not isinstance(v, dict):
        raise ValueError(f"{where} must be an object")  # noqa: TRY004  (one error type for any bad field: the API maps it to 400)
    return v


def _list(event: dict[str, Any], key: str) -> list[Any]:
    v = event.get(key)
    if not isinstance(v, list):
        raise ValueError(f"event: '{key}' is missing or not a list")  # noqa: TRY004  (one error type for any bad field: the API maps it to 400)
    return v


def _order(o: Any, i: int) -> Order:
    w = f"orders[{i}]"
    o = _obj(o, w)
    return Order(
        id=_str(o, "id", w),
        mode=_str(o, "mode", w),
        dest_lat=_num(o, "destLat", w),
        dest_lon=_num(o, "destLon", w),
        payload_kg=_num(o, "payloadKg", w),
        urgency=int(_num(o, "urgency", w)),
        created_s=_num(o, "createdS", w),
    )


def _drone(d: Any, i: int) -> DroneState:
    w = f"drones[{i}]"
    d = _obj(d, w)
    return DroneState(
        id=_str(d, "id", w),
        lat=_num(d, "lat", w),
        lon=_num(d, "lon", w),
        home_lat=_num(d, "homeLat", w),
        home_lon=_num(d, "homeLon", w),
        status=_str(d, "status", w),
        battery_pct=_num(d, "batteryPct", w),
        max_payload_kg=_num(d, "maxPayloadKg", w),
    )


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    event = _obj(event, "event")
    orders = [_order(o, i) for i, o in enumerate(_list(event, "orders"))]
    drones = [_drone(d, i) for i, d in enumerate(_list(event, "drones"))]
    wind = _obj(event.get("wind"), "event: 'wind'")
    wind_ms = _num(wind, "ms", "wind")
    wind_from = _num(wind, "fromDeg", "wind")
    now_s = _num(event, "nowS", "event")

    by_id = {o.id: o for o in orders}
    out = []
    for c in assign(orders, drones, wind_ms, wind_from, now_s):
        out.append(
            {
                "orderId": c.order_id,
                "droneId": c.drone_id,
                "etaMin": c.eta_min,
                "batteryAfterPct": c.battery_after_pct,
                "runnerUp": c.runner_up,
                "aiRationale": explain_with_bedrock(c, by_id[c.order_id]),
            }
        )
    return {"assignments": out}
