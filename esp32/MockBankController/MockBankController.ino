/*
  ESP32 DevKitC controller
  UART2 to Raspberry Pi: GPIO17 TX -> Pi RX, GPIO16 RX <- Pi TX, GND -> GND
  UART format: 115200 baud, 8N1, newline-terminated commands/events.
*/
#include <Arduino.h>
#include <driver/i2s.h>
#include <math.h>

// Joystick buttons (assumed to connect GPIO to GND when pressed)
constexpr uint8_t JOY_UP = 23;
constexpr uint8_t JOY_CENTER = 19;
constexpr uint8_t JOY_LEFT = 13;
constexpr uint8_t JOY_DOWN = 14;
constexpr uint8_t JOY_RIGHT = 21;

// Rotary encoder and MAX98357A I2S amplifier
constexpr uint8_t ENC_CLK = 35; // input-only; needs external pull-up if not on module
constexpr uint8_t ENC_DT = 32;
constexpr uint8_t ENC_SW = 27;
constexpr uint8_t I2S_BCLK = 26;
constexpr uint8_t I2S_LRC = 25;
constexpr uint8_t I2S_DIN = 22;

constexpr uint8_t PI_RX = 16;
constexpr uint8_t PI_TX = 17;
constexpr uint32_t BAUD = 115200;
constexpr uint32_t SAMPLE_RATE = 22050;
constexpr i2s_port_t I2S_PORT = I2S_NUM_0s
HardwareSerial Pi(2);

struct Input {
  const char *name;
  uint8_t pin;
  bool reading;
  bool state;
  uint32_t changed;
};

Input inputs[] = {
    {"up", JOY_UP, HIGH, HIGH, 0},
    {"center", JOY_CENTER, HIGH, HIGH, 0},
    {"left", JOY_LEFT, HIGH, HIGH, 0},
    {"down", JOY_DOWN, HIGH, HIGH, 0},
    {"right", JOY_RIGHT, HIGH, HIGH, 0},
    {"encoder_button", ENC_SW, HIGH, HIGH, 0},
};
constexpr size_t INPUT_COUNT = sizeof(inputs) / sizeof(inputs[0]);
bool audioOK = false;
uint8_t oldClk = HIGH;
char command[80];
size_t commandLength = 0;

void event(const char *name, const char *value) {
  char line[128];
  snprintf(line, sizeof(line), "{\"event\":\"%s\",\"value\":\"%s\"}", name, value);
  Serial.println(line);
  Pi.println(line);
}

bool startI2S() {
  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX);
  cfg.sample_rate = SAMPLE_RATE;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
  cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  cfg.dma_buf_count = 8;
  cfg.dma_buf_len = 256;
  cfg.use_apll = false;
  cfg.tx_desc_auto_clear = true;
  cfg.fixed_mclk = 0;

  i2s_pin_config_t pins = {};
  pins.bck_io_num = I2S_BCLK;
  pins.ws_io_num = I2S_LRC;
  pins.data_out_num = I2S_DIN;
  pins.data_in_num = I2S_PIN_NO_CHANGE;
  if (i2s_driver_install(I2S_PORT, &cfg, 0, nullptr) != ESP_OK) return false;
  if (i2s_set_pin(I2S_PORT, &pins) != ESP_OK) {
    i2s_driver_uninstall(I2S_PORT);
    return false;
  }
  i2s_zero_dma_buffer(I2S_PORT);
  return true;
}

void playTone(uint16_t hz, uint16_t ms) {
  if (!audioOK) return;
  int16_t samples[512]; // 256 stereo frames
  const uint32_t framesTotal = SAMPLE_RATE * ms / 1000;
  for (uint32_t frame = 0; frame < framesTotal;) {
    const uint32_t count = min((uint32_t)256, framesTotal - frame);
    for (uint32_t i = 0; i < count; ++i) {
      const float phase = 2.0f * PI * hz * (frame + i) / SAMPLE_RATE;
      const int16_t sample = (int16_t)(sinf(phase) * 4500.0f);
      samples[2 * i] = sample;
      samples[2 * i + 1] = sample;
    }
    size_t written = 0;
    i2s_write(I2S_PORT, samples, count * 2 * sizeof(int16_t), &written, portMAX_DELAY);
    frame += count;
  }
}

void processCommand(char *line) {
  if (!strcmp(line, "PING")) {
    Pi.println("{\"event\":\"pong\",\"device\":\"esp32\"}");
  } else if (!strcmp(line, "STATUS")) {
    Pi.printf("{\"event\":\"status\",\"audio\":%s}\n", audioOK ? "true" : "false");
  } else if (!strcmp(line, "BEEP")) {
    playTone(880, 140);
    Pi.println("{\"event\":\"played\",\"sound\":\"beep\"}");
  } else if (!strncmp(line, "TONE ", 5)) {
    int hz = 0, ms = 0;
    if (sscanf(line + 5, "%d %d", &hz, &ms) == 2 && hz >= 50 && hz <= 5000 && ms >= 20 && ms <= 3000 && audioOK) {
      playTone((uint16_t)hz, (uint16_t)ms);
      Pi.println("{\"event\":\"played\",\"sound\":\"tone\"}");
    } else {
      Pi.println("{\"event\":\"error\",\"message\":\"invalid tone or audio unavailable\"}");
    }
  } else if (line[0]) {
    Pi.println("{\"event\":\"error\",\"message\":\"unknown command\"}");
  }
}

void readPi() {
  while (Pi.available()) {
    const char c = (char)Pi.read();
    if (c == '\n') {
      command[commandLength] = '\0';
      if (commandLength && command[commandLength - 1] == '\r') command[commandLength - 1] = '\0';
      processCommand(command);
      commandLength = 0;
    } else if (commandLength < sizeof(command) - 1) {
      command[commandLength++] = c;
    } else {
      commandLength = 0;
      Pi.println("{\"event\":\"error\",\"message\":\"command too long\"}");
    }
  }
}

void scanInputs() {
  const uint32_t now = millis();
  for (size_t i = 0; i < INPUT_COUNT; ++i) {
    Input &in = inputs[i];
    const bool value = digitalRead(in.pin);
    if (value != in.reading) {
      in.reading = value;
      in.changed = now;
    }
    if ((now - in.changed) >= 25 && value != in.state) {
      in.state = value;
      event(in.state == LOW ? "button_down" : "button_up", in.name);
    }
  }
  const uint8_t clk = digitalRead(ENC_CLK);
  if (oldClk == HIGH && clk == LOW) event("encoder", digitalRead(ENC_DT) ? "right" : "left");
  oldClk = clk;
}

void setup() {
  Serial.begin(BAUD); // USB serial monitor
  Pi.begin(BAUD, SERIAL_8N1, PI_RX, PI_TX);
  for (size_t i = 0; i < INPUT_COUNT; ++i) {
    pinMode(inputs[i].pin, INPUT_PULLUP);
    inputs[i].reading = inputs[i].state = digitalRead(inputs[i].pin);
    inputs[i].changed = millis();
  }
  pinMode(ENC_CLK, INPUT); // GPIO35 has no internal pull-up
  pinMode(ENC_DT, INPUT_PULLUP);
  oldClk = digitalRead(ENC_CLK);
  audioOK = startI2S();
  delay(100);
  Pi.printf("{\"event\":\"ready\",\"audio\":%s,\"baud\":%u}\n", audioOK ? "true" : "false", BAUD);
  if (audioOK) playTone(660, 100);
}

void loop() {
  readPi();
  scanInputs();
  delay(2);
}
