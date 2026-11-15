#!/usr/bin/env python3
"""Read JSON-line events from the ESP32 over Raspberry Pi UART."""

import json
import sys
import time

import serial


PORT = "/dev/serial0"
BAUD = 115200


def describe(message: dict) -> str:
    event = message.get("event", "unknown")
    value = message.get("value", "")

    if event == "ready":
        return f"ESP32 ready (audio={message.get('audio')}, baud={message.get('baud')})"
    if event == "pong":
        return "ESP32 replied to PING"
    if event == "status":
        return f"ESP32 status: audio={message.get('audio')}"
    if event == "button_down":
        return f"Button pressed: {value}"
    if event == "button_up":
        return f"Button released: {value}"
    if event == "encoder":
        return f"Encoder turned: {value}"
    if event == "played":
        return f"ESP32 played: {message.get('sound')}"
    if event == "error":
        return f"ESP32 error: {message.get('message')}"
    return f"ESP32 event: {message}"


def main() -> int:
    try:
        with serial.Serial(PORT, BAUD, timeout=0.5) as uart:
            # Give the serial connection a moment to settle, then check the
            # ESP32 RX path and sketch with a command the firmware understands.
            time.sleep(0.2)
            uart.write(b"PING\n")
            uart.flush()
            print(f"Listening on {PORT} at {BAUD} baud. Press Ctrl+C to stop.")

            while True:
                raw = uart.readline()
                if not raw:
                    continue

                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue

                try:
                    message = json.loads(line)
                    if isinstance(message, dict):
                        print(describe(message), flush=True)
                    else:
                        print(f"Received: {line}", flush=True)
                except json.JSONDecodeError:
                    print(f"Received non-JSON line: {line}", flush=True)

    except serial.SerialException as exc:
        print(f"Could not open/read {PORT}: {exc}", file=sys.stderr)
        print("Check that UART is enabled and no other program is using it.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
