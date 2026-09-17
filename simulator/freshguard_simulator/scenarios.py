from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .telemetry import DoorState, PowerState, TelemetryPayload, build_telemetry


@dataclass(frozen=True)
class ScenarioStep:
    temperature_c: float
    humidity_pct: float | None = None
    door_state: DoorState | None = None
    power_state: PowerState | None = None


@dataclass(frozen=True)
class Scenario:
    name: str
    tick_seconds: float
    steps: tuple[ScenarioStep, ...]

    def payloads(self, device_id: str) -> list[TelemetryPayload]:
        return [
            build_telemetry(
                device_id=device_id,
                temperature_c=step.temperature_c,
                humidity_pct=step.humidity_pct,
                door_state=step.door_state,
                power_state=step.power_state,
            )
            for step in self.steps
        ]


def _step_from_dict(raw: dict[str, Any]) -> ScenarioStep:
    return ScenarioStep(
        temperature_c=float(raw["temperatureC"]),
        humidity_pct=float(raw["humidityPct"]) if "humidityPct" in raw else None,
        door_state=raw.get("doorState"),
        power_state=raw.get("powerState"),
    )


def load_scenario(path: str | Path) -> Scenario:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    tick_seconds = float(raw.get("tickSeconds", 2))
    if tick_seconds <= 0:
        raise ValueError("scenario tickSeconds must be greater than 0")
    steps = tuple(_step_from_dict(step) for step in raw["steps"])
    if not steps:
        raise ValueError("scenario must include at least one step")
    return Scenario(name=str(raw["name"]), tick_seconds=tick_seconds, steps=steps)


def scenario_path(name: str) -> Path:
    return Path(__file__).resolve().parents[1] / "scenarios" / f"{name}.json"
