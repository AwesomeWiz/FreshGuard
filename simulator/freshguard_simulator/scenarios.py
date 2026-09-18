import json
import os
import time
from freshguard_simulator.telemetry import build_telemetry

class ScenarioStep:
    def __init__(self, d):
        self.temperature_c = d.get("temperatureC")
        self.door_state = d.get("doorState", "UNKNOWN")
        self.power_state = d.get("powerState", "UNKNOWN")
        self.humidity_pct = d.get("humidityPct")

class Scenario:
    def __init__(self, data):
        self.tick_seconds = data.get("tickSeconds", 2)
        self.steps = [ScenarioStep(s) for s in data.get("steps", [])]
        
    def payloads(self, device_id):
        res = []
        for step in self.steps:
            res.append(build_telemetry(
                device_id, step.temperature_c, step.humidity_pct, step.door_state, step.power_state
            ))
            time.sleep(0.001)
        return res

def scenario_path(name: str) -> str:
    return os.path.join(os.path.dirname(os.path.dirname(__file__)), "scenarios", f"{name}.json")

def load_scenario(path: str) -> Scenario:
    with open(path) as f:
        return Scenario(json.load(f))
