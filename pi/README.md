# Raspberry Pi UART receiver

`uart_receiver.py` opens `/dev/serial0` at 115200 baud, sends `PING`, then
prints ESP32 replies and joystick/encoder events.

On Raspberry Pi OS, enable **Serial Port** and disable **Serial Console** in
`sudo raspi-config` under **Interface Options → Serial Port**, then reboot. Close
miniterm before running this script because only one program can own the UART
at a time.

Connect ESP32 GPIO17 TX to Pi GPIO15 RX (physical pin 10), ESP32 GPIO16 RX to
Pi GPIO14 TX (physical pin 8), and connect GND to GND. UART logic must be 3.3 V.

Install and run:

```bash
sudo apt update
sudo apt install python3-serial
python3 uart_receiver.py
```

Run the last command from this directory. `ESP32 replied to PING` confirms the
two-way UART command/reply path. Press joystick buttons or turn the encoder to
see their events. If opening `/dev/serial0` fails with a permission error, add
the `pi` user to the `dialout` group (`sudo usermod -aG dialout pi`) and reboot.
