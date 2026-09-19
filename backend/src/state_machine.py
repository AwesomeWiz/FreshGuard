from enum import Enum
import time

class State(str, Enum):
    NORMAL = "NORMAL"
    WATCHING = "WATCHING"
    ACTIVE = "ACTIVE"
    RECOVERING = "RECOVERING"
    RESOLVED = "RESOLVED"

def evaluate_telemetry(current_state, telemetry, thresholds, state_data):
    """
    Evaluates the state machine based on incoming telemetry.
    Returns (new_state, updated_state_data)
    """
    temp = telemetry.get('temperatureC')
    now = telemetry.get('timestamp', int(time.time()))
    
    is_breached = temp > thresholds['temperature_max']
    
    new_state = current_state
    new_state_data = dict(state_data)
    
    if current_state == State.NORMAL:
        if is_breached:
            new_state = State.WATCHING
            new_state_data['breachStartedAt'] = now
    
    elif current_state == State.WATCHING:
        if not is_breached:
            new_state = State.NORMAL
            new_state_data.pop('breachStartedAt', None)
        else:
            duration = now - new_state_data.get('breachStartedAt', now)
            if duration >= thresholds['duration_seconds']:
                new_state = State.ACTIVE
                # In day 2, we will trigger the incident creation here
                
    elif current_state == State.ACTIVE:
        if not is_breached:
            new_state = State.RECOVERING
            new_state_data['recoveringStartedAt'] = now
            
    elif current_state == State.RECOVERING:
        if is_breached:
            new_state = State.ACTIVE
            new_state_data.pop('recoveringStartedAt', None)
        else:
            duration = now - new_state_data.get('recoveringStartedAt', now)
            if duration >= 15: # 15 seconds stable to resolve
                new_state = State.RESOLVED
                
    elif current_state == State.RESOLVED:
        # A resolved incident goes back to NORMAL once we reset or immediately
        # For simplicity, we just move it to NORMAL to watch for new ones
        if not is_breached:
            new_state = State.NORMAL
            new_state_data = {} # Reset state data
            
    return new_state, new_state_data
