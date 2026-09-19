import uuid
import math
from datetime import datetime, timezone

def build_telemetry(device_id: str, temperature_c: float, humidity_pct: int = None, door_state: str = "UNKNOWN", power_state: str = "UNKNOWN") -> dict:
    if math.isnan(temperature_c) or math.isinf(temperature_c):
        raise ValueError("temperature_c must be finite")
        
    payload = {
        "schemaVersion": 1,
        "eventId": str(uuid.uuid4()),
        "deviceId": device_id,
        "observedAt": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        "temperatureC": temperature_c
    }
    
    if humidity_pct is not None:
        payload["humidityPct"] = humidity_pct
    if door_state:
        payload["doorState"] = door_state
    if power_state:
        payload["powerState"] = power_state
        
    return payload
