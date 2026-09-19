import os
import json
import boto3
from state_machine import State, evaluate_telemetry

dynamodb = boto3.resource('dynamodb')
table_name = os.environ.get('TABLE_NAME', 'FreshGuardState')
table = dynamodb.Table(table_name)

# Configurable thresholds
THRESHOLDS = {
    'temperature_max': 5.0, # 5C demo threshold
    'duration_seconds': 30  # 30 seconds
}

def lambda_handler(event, context):
    print(f"Received telemetry: {json.dumps(event)}")
    
    device_id = event.get('device_id', 'sim-01')
    temperature = event.get('temperatureC')
    
    if temperature is None:
        return {'statusCode': 400, 'body': 'Missing temperatureC'}
        
    # Get current state
    response = table.get_item(Key={'pk': f'DEVICE#{device_id}', 'sk': 'STATE'})
    current_state_item = response.get('Item', {})
    
    current_state = State(current_state_item.get('state', State.NORMAL.value))
    
    # Evaluate new state
    new_state, updated_state_data = evaluate_telemetry(
        current_state, 
        event, 
        THRESHOLDS, 
        current_state_item
    )
    
    # Save raw telemetry
    table.put_item(Item={
        'pk': f'DEVICE#{device_id}',
        'sk': f'TELEMETRY#{int(event.get("timestamp", 0))}',
        'temperatureC': temperature,
        'doorState': event.get('doorState', 'CLOSED'),
        'powerState': event.get('powerState', 'ON'),
        'ttl': int(event.get("timestamp", 0)) + (24 * 3600) # 1 day TTL
    })
    
    # Update state if changed or updated
    if current_state != new_state or updated_state_data != current_state_item:
        updated_state_data['pk'] = f'DEVICE#{device_id}'
        updated_state_data['sk'] = 'STATE'
        updated_state_data['state'] = new_state.value
        table.put_item(Item=updated_state_data)
        
    return {'statusCode': 200, 'body': 'Processed'}
