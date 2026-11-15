# Nạp chương trình cho ESP32 bằng Arduino IDE

Mở `MockBankController.ino` trong Arduino IDE, chọn board ESP32 DevKitC (hoặc
ESP32 Dev Module), chọn cổng USB của board rồi bấm Upload. Cài gói board
Espressif ESP32 trong Boards Manager trước khi nạp. Sketch dùng thư viện I2S
đi kèm gói ESP32; không cần cài thư viện Arduino bên ngoài.

## Chân theo sơ đồ

| Thiết bị | GPIO ESP32 |
| --- | --- |
| Joystick lên / giữa / trái / xuống / phải | 23 / 19 / 13 / 14 / 21 |
| Encoder CLK / DT / nút SW | 35 / 32 / 27 |
| MAX98357A BCLK / LRC / DIN | 26 / 25 / 22 |
| UART2 RX / TX | 16 / 17 |

Các nút được cấu hình kéo lên nội bộ và giả định khi nhấn sẽ nối GPIO xuống
GND. GPIO35 chỉ nhận tín hiệu và không có kéo lên nội bộ; nếu CLK không ổn
định, mắc điện trở 4.7–10 kΩ từ GPIO35 lên 3.3 V.

## Nối UART với Raspberry Pi

- ESP32 GPIO17 (TX) → Pi RX
- ESP32 GPIO16 (RX) ← Pi TX
- GND ESP32 ↔ GND Pi

UART là 115200 baud, 8N1 và mức logic 3.3 V. Không nối chân UART của Pi/ESP32
vào 5 V. Tắt serial login console trên Pi và đảm bảo không có chương trình
khác đang chiếm cổng UART. UART chỉ truyền sự kiện; Pi cần chương trình riêng
để đọc và xử lý các dòng dữ liệu.

## Thử lệnh

Gửi các lệnh ASCII kết thúc bằng newline (`\n`) từ Pi:

```text
PING
STATUS
BEEP
TONE 880 150
```

ESP32 gửi sự kiện dạng JSON Lines, ví dụ:

```json
{"event":"ready","audio":true,"baud":115200}
{"event":"button_down","value":"up"}
{"event":"encoder","value":"left"}
{"event":"pong","device":"esp32"}
```

`TONE` nhận tần số 50–5000 Hz và thời lượng 20–3000 ms. Âm thanh phát qua
MAX98357A và loa nối với ngõ ra ampli. Ngõ ra loa là dạng cầu, không nối một
đầu loa xuống GND. Có thể xem log USB tại 115200 baud bằng Serial Monitor của
Arduino IDE.
