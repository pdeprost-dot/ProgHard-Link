'use strict';

function decodeSampleBlock(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32) throw new Error('short header');
  const magic = buffer.readUInt16LE(0);
  const version = buffer.readUInt8(2);
  const flags = buffer.readUInt8(3);
  const headerSize = buffer.readUInt16LE(30);
  const sampleCount = buffer.readUInt16LE(26);
  if (magic !== 0xec01) throw new Error('bad magic');
  if (version !== 1) throw new Error('bad version');
  if (headerSize !== 32) throw new Error('bad header size');
  if (sampleCount > 33) throw new Error('bad sample count');
  if (buffer.length !== headerSize + sampleCount * 4)
    throw new Error('bad payload length');
  const samples = new Array(sampleCount);
  for (let index = 0; index < sampleCount; index++)
    samples[index] = buffer.readInt32LE(headerSize + index * 4);
  return {
    flags,
    newSession: Boolean(flags & 1),
    sourceId: buffer.readUInt32LE(4),
    blockSequence: buffer.readUInt32LE(8),
    firstSampleSequence: buffer.readUInt32LE(12),
    firstSampleTimestampNs: buffer.readBigUInt64LE(16),
    sampleRateHz: buffer.readUInt16LE(24),
    sampleCount,
    samplesDroppedBeforeBlock: buffer.readUInt16LE(28),
    samples,
  };
}

module.exports = {decodeSampleBlock};
