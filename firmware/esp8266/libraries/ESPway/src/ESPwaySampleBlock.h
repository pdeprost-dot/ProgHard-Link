#pragma once

#include <Arduino.h>

namespace ESPwayTelemetry {

constexpr uint16_t SAMPLE_BLOCK_MAGIC = 0xEC01;
constexpr uint8_t SAMPLE_BLOCK_VERSION = 1;
constexpr uint8_t SAMPLE_BLOCK_FLAG_NEW_SESSION = 0x01;
constexpr uint16_t SAMPLE_BLOCK_HEADER_SIZE = 32;
constexpr uint16_t SAMPLE_BLOCK_MAX_SAMPLES = 33;

struct SampleBlock {
  uint8_t flags = 0;
  uint32_t sourceId = 0;
  uint32_t blockSequence = 0;
  uint32_t firstSampleSequence = 0;
  uint64_t firstSampleTimestampNs = 0;
  uint16_t sampleRateHz = 0;
  uint16_t sampleCount = 0;
  uint16_t samplesDroppedBeforeBlock = 0;
  int32_t samples[SAMPLE_BLOCK_MAX_SAMPLES]{};

  size_t serializedSize() const;
  bool serialize(uint8_t* destination, size_t capacity) const;
};

class SampleBlockBuilder {
 public:
  SampleBlockBuilder(uint32_t sourceId, uint16_t sampleRateHz);
  bool add(int32_t value, uint32_t sequence, uint64_t timestampNs,
           SampleBlock& completed);
  void setSourceId(uint32_t sourceId);
  void startNewSession();
  uint32_t blocksProduced() const;
  uint32_t incompleteBlocksDiscarded() const;

 private:
  SampleBlock current_;
  uint32_t sourceId_;
  uint32_t nextBlockSequence_ = 1;
  uint32_t lastSampleSequence_ = 0;
  uint32_t produced_ = 0;
  uint32_t discarded_ = 0;
  uint16_t sampleRateHz_;
  uint8_t targetSampleCount_ = 32;
  bool haveLastSample_ = false;
  bool newSessionPending_ = true;

  void beginBlock(uint32_t sequence, uint64_t timestampNs,
                  uint16_t droppedBefore);
  void discardPartial();
};

template <size_t Capacity>
class SampleBlockRing {
 public:
  void push(const SampleBlock& block) {
    if (count_ == Capacity) {
      tail_ = (tail_ + 1) % Capacity;
      --count_;
      ++overwritten_;
    }
    blocks_[head_] = block;
    head_ = (head_ + 1) % Capacity;
    ++count_;
  }

  size_t collectAfter(uint32_t after, size_t maximum, SampleBlock* output,
                      bool& gap, uint32_t& oldest, uint32_t& newest) const {
    gap = false;
    if (count_ == 0 || maximum == 0) {
      oldest = newest = 0;
      return 0;
    }
    oldest = blocks_[tail_].blockSequence;
    newest = blocks_[(head_ + Capacity - 1) % Capacity].blockSequence;
    gap = after != 0 && after + 1 < oldest;
    size_t result = 0;
    for (size_t index = 0; index < count_ && result < maximum; ++index) {
      const SampleBlock& block = blocks_[(tail_ + index) % Capacity];
      if (after == 0 || block.blockSequence > after) output[result++] = block;
    }
    return result;
  }

  size_t size() const { return count_; }
  uint32_t overwritten() const { return overwritten_; }

 private:
  SampleBlock blocks_[Capacity]{};
  size_t head_ = 0;
  size_t tail_ = 0;
  size_t count_ = 0;
  uint32_t overwritten_ = 0;
};

}  // namespace ESPwayTelemetry
