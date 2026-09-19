import os
import sys
import time
import json
import argparse
from dotenv import load_dotenv
from AWSIoTPythonSDK.MQTTLib import AWSIoTMQTTClient

from freshguard_simulator.scenarios import load_scenario, scenario_path

# Load config
load_dotenv()
ENDPOINT = os.getenv("AWS_IOT_ENDPOINT", "YOUR_AWS_IOT_ENDPOINT")
CLIENT_ID = os.getenv("AWS_IOT_CLIENT_ID", "FreshGuardSimulator")
TOPIC = os.getenv("AWS_IOT_TOPIC", "freshguard/dev/devices/cold-room-01/telemetry")
CERT_PATH = os.getenv("AWS_IOT_CERT_PATH", ".simulator-certs/device.pem.crt")
KEY_PATH = os.getenv("AWS_IOT_PRIVATE_KEY_PATH", ".simulator-certs/private.pem.key")
CA_PATH = os.getenv("AWS_IOT_ROOT_CA_PATH", ".simulator-certs/AmazonRootCA1.pem")
DEVICE_ID = os.getenv("DEVICE_ID", "cold-room-01")

def setup_client():
    cert_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    root_ca = os.path.join(cert_dir, CA_PATH)
    private_key = os.path.join(cert_dir, KEY_PATH)
    cert = os.path.join(cert_dir, CERT_PATH)
    
    client = AWSIoTMQTTClient(CLIENT_ID)
    client.configureEndpoint(ENDPOINT, 8883)
    
    if not os.path.exists(root_ca):
        print("Warning: Certificates not found, running in local-only mock mode.")
        return None
        
    client.configureCredentials(root_ca, private_key, cert)
    client.configureAutoReconnectBackoffTime(1, 32, 20)
    client.configureOfflinePublishQueueing(-1)
    client.configureDrainingFrequency(2)
    client.configureConnectDisconnectTimeout(10)
    client.configureMQTTOperationTimeout(5)
    return client

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scenario', choices=['normal', 'breach-door-open', 'recovery'], default='normal')
    args = parser.parse_args()
    
    print(f"Starting simulator in {args.scenario} scenario...")
    client = setup_client()
    
    if client:
        try:
            print(f"Connecting to {ENDPOINT}...")
            client.connect()
            print("Connected!")
        except Exception as e:
            print(f"Connection failed: {e}")
            client = None
            
    scenario = load_scenario(scenario_path(args.scenario))
    
    for payload in scenario.payloads(DEVICE_ID):
        msg = json.dumps(payload)
        print(f"Publishing: {msg}")
        
        if client:
            try:
                client.publish(TOPIC, msg, 1)
            except Exception as e:
                print(f"Publish error: {e}")
                
        time.sleep(scenario.tick_seconds)

if __name__ == "__main__":
    main()
