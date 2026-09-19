from __future__ import annotations

import time
from datetime import datetime
from uuid import UUID

import pytest

from freshguard_simulator.telemetry import build_telemetry


def test_payload_matches_shared_contract() -> None:
    payload = build_telemetry(
        device_id="cold-room-01",
        temperature_c=4.2,
        humidity_pct=64,
        door_state="CLOSED",
        power_state="ON",
    )

    assert payload["schemaVersion"] == 1
    UUID(payload["eventId"])
    assert payload["deviceId"] == "cold-room-01"
    parsed = datetime.fromisoformat(payload["observedAt"].replace("Z", "+00:00"))
    assert parsed.utcoffset().total_seconds() == 0
    assert payload["temperatureC"] == 4.2
    assert payload["humidityPct"] == 64
    assert payload["doorState"] == "CLOSED"
    assert payload["powerState"] == "ON"


def test_event_ids_are_unique_and_timestamps_increase() -> None:
    first = build_telemetry(device_id="cold-room-01", temperature_c=4.2)
    time.sleep(0.002)
    second = build_telemetry(device_id="cold-room-01", temperature_c=4.3)

    assert first["eventId"] != second["eventId"]
    assert first["observedAt"] < second["observedAt"]


@pytest.mark.parametrize("temperature", [float("nan"), float("inf"), float("-inf")])
def test_temperature_must_be_finite(temperature: float) -> None:
    with pytest.raises(ValueError, match="finite"):
        build_telemetry(device_id="cold-room-01", temperature_c=temperature)
