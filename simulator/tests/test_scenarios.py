from __future__ import annotations

from freshguard_simulator.scenarios import load_scenario, scenario_path


def temperatures(name: str) -> list[float]:
    scenario = load_scenario(scenario_path(name))
    return [step.temperature_c for step in scenario.steps]


def test_normal_sequence_is_deterministic() -> None:
    assert temperatures("normal") == [4.2, 4.4, 4.6, 4.3]


def test_breach_sequence_is_deterministic_and_sustained() -> None:
    scenario = load_scenario(scenario_path("breach-door-open"))
    values = temperatures("breach-door-open")

    assert values[:5] == [4.4, 6.0, 8.4, 9.2, 10.1]
    first_breach = next(index for index, value in enumerate(values) if value > 8.0)
    assert all(value > 8.0 for value in values[first_breach:])
    assert (len(values) - 1 - first_breach) * scenario.tick_seconds >= 20
    assert scenario.steps[0].door_state == "CLOSED"
    assert all(step.door_state == "OPEN" for step in scenario.steps[1:])
    assert all(step.power_state == "ON" for step in scenario.steps)


def test_recovery_returns_below_threshold_and_stays_there() -> None:
    scenario = load_scenario(scenario_path("recovery"))
    values = temperatures("recovery")
    first_recovered = next(index for index, value in enumerate(values) if value <= 8.0)

    assert values[:first_recovered] == [10.1, 9.0]
    assert all(value <= 8.0 for value in values[first_recovered:])
    assert (len(values) - 1 - first_recovered) * scenario.tick_seconds >= 15


def test_scenario_payloads_get_runtime_ids_and_timestamps() -> None:
    scenario = load_scenario(scenario_path("normal"))
    payloads = scenario.payloads("cold-room-01")
    assert len({payload["eventId"] for payload in payloads}) == len(payloads)
    assert [payload["observedAt"] for payload in payloads] == sorted(payload["observedAt"] for payload in payloads)
