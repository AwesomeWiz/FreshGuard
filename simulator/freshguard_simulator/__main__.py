from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from .config import SimulatorConfig
from .publisher import AwsIotPublisher
from .scenarios import load_scenario, scenario_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="FreshGuard AWS IoT telemetry simulator")
    parser.add_argument("scenario", nargs="?", default="normal", help="Scenario filename without .json")
    parser.add_argument("--env-file", default=".env", help="Environment file path")
    parser.add_argument("--tick-seconds", type=float, help="Override scenario/environment tick interval")
    parser.add_argument("--dry-run", action="store_true", help="Print telemetry without connecting to AWS")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = SimulatorConfig.from_env(Path(args.env_file))
    scenario = load_scenario(scenario_path(args.scenario))
    tick_seconds = args.tick_seconds or config.tick_seconds or scenario.tick_seconds
    if tick_seconds <= 0:
        raise ValueError("tick interval must be greater than 0")

    publisher = None if args.dry_run else AwsIotPublisher(config)
    if publisher:
        publisher.connect()

    try:
        for index, step in enumerate(scenario.steps, start=1):
            payload = step.to_payload(config.device_id)
            print(json.dumps(payload, indent=2))
            if publisher:
                publisher.publish(payload)
                print(f"published {index}/{len(scenario.steps)} -> {config.topic}")
            if index < len(scenario.steps):
                time.sleep(tick_seconds)
    finally:
        if publisher:
            publisher.disconnect()


if __name__ == "__main__":
    main()
