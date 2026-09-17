from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Literal, TypedDict
from uuid import uuid4

DoorState = Literal["OPEN", "CLOSED", "UNKNOWN"]
PowerState = Literal["ON", "OFF", "UNKNOWN"]


class TelemetryPayload(TypedDict, total=False):
    schemaVersion: int
    eventId: str
    deviceId: str
    observedAt: str
    temperatureC: float
    humidityPct: float
    doorState: DoorState
    powerState: PowerState


def utc_now_iso() -> str:
    """Return a fresh UTC timestamp using the project's ISO-8601 `Z` convention."""
    now = datetime.now(timezone.utc)
    return now.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def build_telemetry(
    *,
    device_id: str,
    temperature_c: float,
    humidity_pct: float | None = None,
    door_state: DoorState | None = None,
    power_state: PowerState | None = None,
) -> TelemetryPayload:
    """Build one schemaVersion=1 telemetry message with runtime identity/time fields."""
    if not device_id:
        raise ValueError("device_id must not be empty")
    if isinstance(temperature_c, bool) or not isinstance(temperature_c, (int, float)):
        raise ValueError("temperature_c must be a number")
    if not math.isfinite(float(temperature_c)):
        raise ValueError("temperature_c must be finite")

    payload: TelemetryPayload = {
        "schemaVersion": 1,
        "eventId": str(uuid4()),
        "deviceId": device_id,
        "observedAt": utc_now_iso(),
        "temperatureC": float(temperature_c),
    }

    if humidity_pct is not None:
        if isinstance(humidity_pct, bool) or not isinstance(humidity_pct, (int, float)):
            raise ValueError("humidity_pct must be a number")
        humidity = float(humidity_pct)
        if not math.isfinite(humidity) or not 0 <= humidity <= 100:
            raise ValueError("humidity_pct must be between 0 and 100")
        payload["humidityPct"] = humidity

    if door_state is not None:
        if door_state not in {"OPEN", "CLOSED", "UNKNOWN"}:
            raise ValueError("invalid door_state")
        payload["doorState"] = door_state

    if power_state is not None:
        if power_state not in {"ON", "OFF", "UNKNOWN"}:
            raise ValueError("invalid power_state")
        payload["powerState"] = power_state

    return payload
