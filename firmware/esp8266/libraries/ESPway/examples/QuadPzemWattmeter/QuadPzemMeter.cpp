#include "QuadPzemMeter.h"

namespace {

constexpr uint32_t RESPONSE_TIMEOUT_MS = 350;
constexpr size_t RESPONSE_SIZE = 25;

uint16_t register16(const uint8_t* response, uint8_t index) {
  const size_t offset = 3 + static_cast<size_t>(index) * 2;
  return (static_cast<uint16_t>(response[offset]) << 8) |
         response[offset + 1];
}

uint32_t register32(const uint8_t* response, uint8_t index) {
  return static_cast<uint32_t>(register16(response, index)) |
         (static_cast<uint32_t>(register16(response, index + 1)) << 16);
}

}  // namespace

QuadPzemMeter::QuadPzemMeter() : bus(RX_GPIO, TX_GPIO) {
}

void QuadPzemMeter::begin() {
  bus.begin(9600);
  bus.setTimeout(RESPONSE_TIMEOUT_MS);
}

void QuadPzemMeter::readAll() {
  for (uint8_t index = 0; index < METER_COUNT; ++index) {
    PzemReading next = readings[index];
    if (readOne(index + 1, next)) {
      next.valid = true;
      next.updatedAt = millis();
      readings[index] = next;
    } else {
      readings[index].valid = false;
      ++readings[index].errors;
      Serial.println("PZEM address " + String(index + 1) + " did not reply");
    }
    yield();
  }
}

const PzemReading& QuadPzemMeter::reading(uint8_t index) const {
  return readings[index < METER_COUNT ? index : 0];
}

bool QuadPzemMeter::readOne(uint8_t address, PzemReading& result) {
  while (bus.available()) bus.read();

  uint8_t request[] = {address, 0x04, 0x00, 0x00, 0x00, 0x0A, 0, 0};
  const uint16_t requestCrc = crc16(request, 6);
  request[6] = requestCrc & 0xff;
  request[7] = requestCrc >> 8;
  bus.write(request, sizeof(request));
  bus.flush();

  uint8_t response[RESPONSE_SIZE];
  size_t received = 0;
  const uint32_t startedAt = millis();
  while (received < sizeof(response) && millis() - startedAt < RESPONSE_TIMEOUT_MS) {
    if (bus.available()) {
      response[received++] = bus.read();
    } else {
      delay(1);
    }
  }

  if (received != sizeof(response) || response[0] != address ||
      response[1] != 0x04 || response[2] != 20) {
    return false;
  }
  const uint16_t responseCrc = crc16(response, RESPONSE_SIZE - 2);
  if (response[23] != (responseCrc & 0xff) || response[24] != (responseCrc >> 8)) {
    return false;
  }

  result.voltage = register16(response, 0) / 10.0f;
  result.current = register32(response, 1) / 1000.0f;
  result.power = register32(response, 3) / 10.0f;
  result.energyWh = register32(response, 5);
  result.frequency = register16(response, 7) / 10.0f;
  result.powerFactor = register16(response, 8) / 100.0f;
  result.alarm = register16(response, 9) != 0;
  return true;
}

uint16_t QuadPzemMeter::crc16(const uint8_t* data, size_t length) {
  uint16_t crc = 0xffff;
  for (size_t index = 0; index < length; ++index) {
    crc ^= data[index];
    for (uint8_t bit = 0; bit < 8; ++bit) {
      crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
    }
  }
  return crc;
}
