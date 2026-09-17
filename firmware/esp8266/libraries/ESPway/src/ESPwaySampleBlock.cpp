#include "ESPwaySampleBlock.h"

namespace ESPwayTelemetry {
namespace {
void put16(uint8_t* out, uint16_t value) {
  out[0] = value & 0xff; out[1] = value >> 8;
}
void put32(uint8_t* out, uint32_t value) {
  for (uint8_t i = 0; i < 4; ++i) out[i] = value >> (8 * i);
}
void put64(uint8_t* out, uint64_t value) {
  for (uint8_t i = 0; i < 8; ++i) out[i] = value >> (8 * i);
}
}

size_t SampleBlock::serializedSize() const {
  return SAMPLE_BLOCK_HEADER_SIZE + static_cast<size_t>(sampleCount) * 4;
}

bool SampleBlock::serialize(uint8_t* out, size_t capacity) const {
  if (!out || sampleCount > SAMPLE_BLOCK_MAX_SAMPLES ||
      capacity < serializedSize()) return false;
  put16(out, SAMPLE_BLOCK_MAGIC);
  out[2] = SAMPLE_BLOCK_VERSION; out[3] = flags;
  put32(out + 4, sourceId); put32(out + 8, blockSequence);
  put32(out + 12, firstSampleSequence);
  put64(out + 16, firstSampleTimestampNs);
  put16(out + 24, sampleRateHz); put16(out + 26, sampleCount);
  put16(out + 28, samplesDroppedBeforeBlock);
  put16(out + 30, SAMPLE_BLOCK_HEADER_SIZE);
  for (uint16_t i = 0; i < sampleCount; ++i)
    put32(out + SAMPLE_BLOCK_HEADER_SIZE + i * 4,
          static_cast<uint32_t>(samples[i]));
  return true;
}

SampleBlockBuilder::SampleBlockBuilder(uint32_t sourceId, uint16_t sampleRateHz)
    : sourceId_(sourceId), sampleRateHz_(sampleRateHz) {}

void SampleBlockBuilder::setSourceId(uint32_t sourceId) {
  sourceId_ = sourceId;
}

void SampleBlockBuilder::discardPartial() {
  if (current_.sampleCount != 0) ++discarded_;
  current_.sampleCount = 0;
}

void SampleBlockBuilder::startNewSession() {
  discardPartial();
  haveLastSample_ = false;
  newSessionPending_ = true;
  targetSampleCount_ = 32;
}

void SampleBlockBuilder::beginBlock(uint32_t sequence, uint64_t timestampNs,
                                    uint16_t droppedBefore) {
  current_.flags = newSessionPending_ ? SAMPLE_BLOCK_FLAG_NEW_SESSION : 0;
  current_.sourceId = sourceId_;
  current_.blockSequence = nextBlockSequence_;
  current_.firstSampleSequence = sequence;
  current_.firstSampleTimestampNs = timestampNs;
  current_.sampleRateHz = sampleRateHz_;
  current_.sampleCount = 0;
  current_.samplesDroppedBeforeBlock = droppedBefore;
}

bool SampleBlockBuilder::add(int32_t value, uint32_t sequence,
                             uint64_t timestampNs, SampleBlock& completed) {
  uint16_t droppedBefore = 0;
  if (haveLastSample_ && sequence != lastSampleSequence_ + 1) {
    const uint32_t difference = sequence - lastSampleSequence_ - 1;
    droppedBefore = difference > UINT16_MAX ? UINT16_MAX : difference;
    discardPartial();
  }
  if (current_.sampleCount == 0) beginBlock(sequence, timestampNs, droppedBefore);
  current_.samples[current_.sampleCount++] = value;
  lastSampleSequence_ = sequence;
  haveLastSample_ = true;
  if (current_.sampleCount < targetSampleCount_) return false;
  completed = current_;
  ++nextBlockSequence_; ++produced_;
  newSessionPending_ = false;
  current_.sampleCount = 0;
  targetSampleCount_ = targetSampleCount_ == 32 ? 33 : 32;
  return true;
}

uint32_t SampleBlockBuilder::blocksProduced() const { return produced_; }
uint32_t SampleBlockBuilder::incompleteBlocksDiscarded() const {
  return discarded_;
}
}  // namespace ESPwayTelemetry
