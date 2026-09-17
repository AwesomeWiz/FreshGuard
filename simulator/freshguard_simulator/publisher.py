from __future__ import annotations

import json
from typing import Any

from awscrt import io, mqtt
from awsiot import mqtt_connection_builder

from .config import SimulatorConfig


class AwsIotPublisher:
    """Small AWS IoT Core MQTT/TLS publisher for one software-defined device."""

    def __init__(self, config: SimulatorConfig) -> None:
        self.config = config
        self._event_loop_group = io.EventLoopGroup(1)
        self._host_resolver = io.DefaultHostResolver(self._event_loop_group)
        self._client_bootstrap = io.ClientBootstrap(self._event_loop_group, self._host_resolver)
        self._connection = mqtt_connection_builder.mtls_from_path(
            endpoint=config.endpoint,
            cert_filepath=str(config.cert_path),
            pri_key_filepath=str(config.private_key_path),
            client_bootstrap=self._client_bootstrap,
            ca_filepath=str(config.root_ca_path),
            client_id=config.client_id,
            clean_session=False,
            keep_alive_secs=30,
        )

    def connect(self) -> None:
        self._connection.connect().result()

    def publish(self, payload: dict[str, Any]) -> None:
        publish_future, _ = self._connection.publish(
            topic=self.config.topic,
            payload=json.dumps(payload, separators=(",", ":")),
            qos=mqtt.QoS.AT_LEAST_ONCE,
        )
        publish_future.result()

    def disconnect(self) -> None:
        self._connection.disconnect().result()
