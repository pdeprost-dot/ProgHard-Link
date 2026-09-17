#!/usr/bin/env python3
"""Exercise ESPway MQTT V2 against a real broker."""

import argparse
import collections
import threading
import time
import urllib.request

import paho.mqtt.client as mqtt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, default=1883)
    parser.add_argument("--base", required=True)
    parser.add_argument("--restart-url")
    parser.add_argument("--timeout", type=float, default=45)
    args = parser.parse_args()

    received = collections.defaultdict(list)
    lock = threading.Lock()
    connected = threading.Event()

    def on_connect(client, _userdata, _flags, reason_code, _properties):
        if reason_code == 0:
            client.subscribe(args.base + "/#")
            connected.set()

    def on_message(_client, _userdata, message):
        value = message.payload.decode("utf-8", errors="replace")
        with lock:
            received[message.topic].append((value, message.retain, time.time()))
        print(f"{message.topic} {value} retained={message.retain}")

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(args.host, args.port, 10)
    client.loop_start()
    try:
        if not connected.wait(10):
            raise RuntimeError("broker connection timeout")
        time.sleep(3)

        required = [
            "status", "system/uptime", "system/free_heap",
            "system/wifi_rssi", "system/ip", "demo/value",
        ]
        missing = [name for name in required if not received[args.base + "/" + name]]
        if missing:
            raise RuntimeError("missing retained topics: " + ", ".join(missing))

        value_topic = args.base + "/demo/value"
        before = len(received[value_topic])
        for _ in range(2):
            client.publish(args.base + "/demo/value/set", "42")
            time.sleep(1)
        deadline = time.time() + 8
        while len(received[value_topic]) < before + 2 and time.time() < deadline:
            time.sleep(0.1)
        if len(received[value_topic]) < before + 2:
            raise RuntimeError("identical consecutive commands were not both handled")

        if args.restart_url:
            availability = args.base + "/status"
            marker = len(received[availability])
            request = urllib.request.Request(args.restart_url, method="POST")
            with urllib.request.urlopen(request, timeout=10) as response:
                response.read()
            deadline = time.time() + args.timeout
            while time.time() < deadline:
                states = [item[0] for item in received[availability][marker:]]
                if "offline" in states and "online" in states:
                    break
                time.sleep(0.25)
            else:
                raise RuntimeError("Last Will offline/online sequence not observed")

            before = len(received[value_topic])
            client.publish(args.base + "/demo/value/set", "43")
            deadline = time.time() + 8
            while len(received[value_topic]) <= before and time.time() < deadline:
                time.sleep(0.1)
            if len(received[value_topic]) <= before:
                raise RuntimeError("subscription was not restored after reconnect")

        print("SUMMARY retained=OK identical_commands=OK last_will={} restore={}".format(
            "OK" if args.restart_url else "SKIPPED",
            "OK" if args.restart_url else "SKIPPED",
        ))
    finally:
        client.disconnect()
        client.loop_stop()


if __name__ == "__main__":
    main()
