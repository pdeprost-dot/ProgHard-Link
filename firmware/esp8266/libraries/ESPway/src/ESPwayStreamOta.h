#pragma once

#include <Arduino.h>
#include "ESPwayPlatform.h"

#include "ESPwayOtaAuthorization.h"

class ESPwayStreamOta {
 public:
  static constexpr size_t DATA_CHUNK_SIZE = 512;

  bool begin(
    ESPwayOtaAuthorization& authorization,
    const String& deviceToken,
    const String& deviceId,
    size_t expectedSize,
    const String& expectedSha256,
    const String& proof
  );
  bool write(const uint8_t* data, size_t length);
  bool finish();
  void abort();
  bool active() const { return running; }
  size_t bytesWritten() const { return written; }
  uint32_t minimumHeap() const { return minHeap; }
  uint32_t minimumBlock() const { return minBlock; }
  uint8_t maximumFragmentation() const { return maxFragmentation; }
  uint32_t durationMs() const { return elapsedMs; }

 private:
  ESPwayPlatform::Sha256 shaContext;
  uint8_t expectedDigest[32]{};
  size_t expected = 0;
  size_t written = 0;
  bool running = false;
  uint32_t minHeap = 0;
  uint32_t minBlock = 0;
  uint8_t maxFragmentation = 0;
  unsigned long startedAt = 0;
  uint32_t elapsedMs = 0;

  void sampleMemory();
};
