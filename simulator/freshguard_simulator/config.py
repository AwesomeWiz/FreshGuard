from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class SimulatorConfig:
    endpoint: str
    client_id: str
    topic: str
    cert_path: Path
    private_key_path: Path
    root_ca_path: Path
    device_id: str
    tick_seconds: float

    @classmethod
    def from_env(cls, env_file: str | Path | None = None) -> "SimulatorConfig":
        load_dotenv(dotenv_path=env_file)

        def required(name: str) -> str:
            value = os.getenv(name, "").strip()
            if not value:
                raise ValueError(f"Missing required environment variable: {name}")
            return value

        tick_seconds = float(os.getenv("TICK_SECONDS", "2"))
        if tick_seconds <= 0:
            raise ValueError("TICK_SECONDS must be greater than 0")

        return cls(
            endpoint=required("AWS_IOT_ENDPOINT"),
            client_id=required("AWS_IOT_CLIENT_ID"),
            topic=required("AWS_IOT_TOPIC"),
            cert_path=Path(required("AWS_IOT_CERT_PATH")).expanduser(),
            private_key_path=Path(required("AWS_IOT_PRIVATE_KEY_PATH")).expanduser(),
            root_ca_path=Path(required("AWS_IOT_ROOT_CA_PATH")).expanduser(),
            device_id=required("DEVICE_ID"),
            tick_seconds=tick_seconds,
        )
