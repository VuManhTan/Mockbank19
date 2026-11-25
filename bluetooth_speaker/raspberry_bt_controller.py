
import serial
import subprocess
import threading
import time
import re
import sys

# =====================================================
# 1. CONFIGURATION
# =====================================================

SERIAL_PORT = "/dev/ttyAMA5"
BAUDRATE = 115200

BT_DEVICE_NAME = "MockBank Speaker"

VOLUME_STEP = "5%"

ser = None
serial_lock = threading.Lock()

running = True
bluetooth_mac = None


# =====================================================
# 2. SYSTEM COMMAND
# =====================================================

def run_command(command, timeout=10):

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout
        )

        return result.stdout.strip()

    except Exception as e:
        print("[ERROR]", e)
        return ""


# =====================================================
# 3. BLUETOOTH FUNCTIONS
# =====================================================

def bluetooth_scan():

    global bluetooth_mac

    print("\n[Bluetooth] Scanning for ESP32...")
    print("[Bluetooth] ESP32 name:", BT_DEVICE_NAME)

    try:
        subprocess.run(
            ["bluetoothctl", "--timeout", "15", "scan", "on"],
            capture_output=True,
            text=True,
            timeout=20
        )

    except Exception:
        pass

    devices = run_command(["bluetoothctl", "devices"])

    for line in devices.splitlines():

        if BT_DEVICE_NAME.lower() in line.lower():

            match = re.search(
                r"Device\s+([0-9A-Fa-f:]{17})",
                line
            )

            if match:
                bluetooth_mac = match.group(1)
                break

    if bluetooth_mac:
        print("[Bluetooth] Found ESP32:", bluetooth_mac)
        return bluetooth_mac

    print("[Bluetooth] Cannot find MockBank Speaker")
    print("[Bluetooth] Check ESP32 power and A2DP initialization")

    return None


def bluetooth_connect():

    global bluetooth_mac

    if not bluetooth_mac:
        if not bluetooth_scan():
            return False

    print("\n[Bluetooth] Pairing...")

    # Pairing may report that the device is already paired.
    run_command(
        ["bluetoothctl", "pair", bluetooth_mac],
        timeout=20
    )

    print("[Bluetooth] Trusting device...")

    run_command(
        ["bluetoothctl", "trust", bluetooth_mac]
    )

    print("[Bluetooth] Connecting...")

    result = run_command(
        ["bluetoothctl", "connect", bluetooth_mac],
        timeout=25
    )

    print(result)

    time.sleep(3)

    return bluetooth_audio_setup()


# =====================================================
# 4. FIND BLUETOOTH AUDIO SINK
# =====================================================

def find_bluetooth_sink():

    status = run_command(["wpctl", "status", "-n"])

    in_sinks = False

    for line in status.splitlines():

        if "Sinks:" in line:
            in_sinks = True
            continue

        if in_sinks:

            if "Sources:" in line:
                break

            # Example:
            #  52. MockBank Speaker [vol: 0.50]
            match = re.search(
                r"^\s*\*?\s*(\d+)\.\s+(.*)$",
                line
            )

            if not match:
                continue

            sink_id = match.group(1)
            sink_name = match.group(2)

            if (
                BT_DEVICE_NAME.lower() in sink_name.lower()
                or "bluez_output" in sink_name.lower()
            ):
                print("[Audio] Found Bluetooth sink:", sink_name)
                return sink_id

    return None


def bluetooth_audio_setup():

    print("\n[Audio] Waiting for Bluetooth audio output...")

    for i in range(20):

        sink_id = find_bluetooth_sink()

        if sink_id:

            result = run_command(
                ["wpctl", "set-default", sink_id]
            )

            print("[Audio] Default output set to:", sink_id)

            time.sleep(1)

            print("[Audio] Current audio status:")
            print(run_command(["wpctl", "status"]))

            return True

        time.sleep(1)

    print("[Audio] Bluetooth sink not detected.")
    print("[Audio] Run: wpctl status")
    print("[Audio] Find the Bluetooth output and set it manually.")

    return False


# =====================================================
# 5. VOLUME CONTROL
# =====================================================

def volume_up():

    run_command([
        "wpctl",
        "set-volume",
        "@DEFAULT_AUDIO_SINK@",
        VOLUME_STEP + "+"
    ])

    print("[Audio] Volume UP")


def volume_down():

    run_command([
        "wpctl",
        "set-volume",
        "@DEFAULT_AUDIO_SINK@",
        VOLUME_STEP + "-"
    ])

    print("[Audio] Volume DOWN")


def volume_mute():

    run_command([
        "wpctl",
        "set-mute",
        "@DEFAULT_AUDIO_SINK@",
        "toggle"
    ])

    print("[Audio] MUTE TOGGLE")


def volume_status():

    print(run_command([
        "wpctl",
        "get-volume",
        "@DEFAULT_AUDIO_SINK@"
    ]))


# =====================================================
# 6. UART FUNCTIONS
# =====================================================

def uart_send(message):

    if ser is None or not ser.is_open:
        print("[UART] Port not available")
        return

    try:
        with serial_lock:

            ser.write((message + "\n").encode("utf-8"))
            ser.flush()

        print("[UART TX]", message)

    except Exception as e:
        print("[UART ERROR]", e)


def process_esp32_message(message):

    message = message.strip()

    if not message:
        return

    print("[ESP32]", message)

    # Encoder volume control
    if message == "VOL,+":

        volume_up()

    elif message == "VOL,-":

        volume_down()

    # Encoder mute button
    elif message == "MUTE":

        volume_mute()

    # Joystick data
    elif message.startswith("JOY,"):

        try:
            values = message.split(",")

            x = int(values[1])
            y = int(values[2])
            sw = int(values[3])

            print(
                "[JOYSTICK] X={} Y={} SW={}".format(
                    x, y, sw
                )
            )

        except Exception:
            print("[UART] Invalid joystick data")

    # ESP32 responses
    elif message == "PONG":
        print("[UART] ESP32 connection OK")

    elif message == "LED_OK":
        print("[LED] Command successful")

    elif message == "LED_OFF":
        print("[LED] Turned OFF")

    elif message == "LED_ERROR":
        print("[LED] Invalid command")


def uart_receive_thread():

    global running

    print("[UART] Receive thread started")

    while running:

        try:
            if ser and ser.is_open and ser.in_waiting:

                message = ser.readline().decode(
                    "utf-8",
                    errors="ignore"
                ).strip()

                if message:
                    process_esp32_message(message)

            else:
                time.sleep(0.005)

        except Exception as e:

            print("[UART ERROR]", e)
            time.sleep(1)


def uart_setup():

    global ser

    try:

        ser = serial.Serial(
            port=SERIAL_PORT,
            baudrate=BAUDRATE,
            timeout=0.1
        )

        time.sleep(2)

        print("[UART] Connected:", SERIAL_PORT)
        print("[UART] Baudrate:", BAUDRATE)

        return True

    except Exception as e:

        print("[UART] Cannot open serial port")
        print("[UART]", e)

        return False


# =====================================================
# 7. COMMAND LINE INTERFACE
# =====================================================

def show_help():

    print("""
========================================
        MOCKBANK SPEAKER CONTROL
========================================

LED CONTROL:
    led 255 0 0       Red
    led 0 255 0       Green
    led 0 0 255       Blue
    led 255 255 255   White
    off               Turn LED OFF

UART:
    ping              Check ESP32 connection

AUDIO:
    volume            Show current volume
    up                Volume UP
    down              Volume DOWN
    mute              Toggle MUTE

BLUETOOTH:
    bt                Reconnect Bluetooth

SYSTEM:
    help              Show commands
    exit              Exit program

========================================
""")


def command_handler():

    global running

    show_help()

    while running:

        try:
            command = input("\nMockBank> ").strip()

        except (KeyboardInterrupt, EOFError):
            break

        if not command:
            continue

        args = command.split()

        cmd = args[0].lower()

        if cmd == "help":

            show_help()

        elif cmd == "led":

            if len(args) == 4:

                try:

                    r = int(args[1])
                    g = int(args[2])
                    b = int(args[3])

                    r = max(0, min(255, r))
                    g = max(0, min(255, g))
                    b = max(0, min(255, b))

                    uart_send(
                        "LED,{},{},{}".format(r, g, b)
                    )

                except ValueError:
                    print("Invalid RGB values")

            else:
                print("Usage: led R G B")

        elif cmd == "off":

            uart_send("LED,OFF")

        elif cmd == "ping":

            uart_send("PING")

        elif cmd == "volume":

            volume_status()

        elif cmd == "up":

            volume_up()

        elif cmd == "down":

            volume_down()

        elif cmd == "mute":

            volume_mute()

        elif cmd == "bt":

            bluetooth_connect()

        elif cmd == "exit":

            running = False
            break

        else:

            print("Unknown command. Type help.")


# =====================================================
# 8. MAIN
# =====================================================

def main():

    global running

    print("\n========================================")
    print("       MOCKBANK BLUETOOTH SPEAKER")
    print("========================================")

    # Start UART
    if not uart_setup():

        print("[FATAL] UART initialization failed")
        print("Check SERIAL_PORT and permissions")
        return

    # Start UART receive thread
    thread = threading.Thread(
        target=uart_receive_thread,
        daemon=True
    )

    thread.start()

    # Connect Bluetooth
    bluetooth_connect()

    # Start command interface
    command_handler()

    # Shutdown
    running = False

    if ser and ser.is_open:
        ser.close()

    print("\n[System] Program stopped")


if __name__ == "__main__":
    main()

