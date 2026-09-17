'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {decodeSampleBlock} = require('../sampleblock/decoder');
const {EcgProcessor} = require('../ecg/processor');

function encode(samples, options = {}) {
  const buffer = Buffer.alloc(32 + samples.length * 4);
  buffer.writeUInt16LE(0xec01, 0);
  buffer.writeUInt8(1, 2);
  buffer.writeUInt8(options.flags || 0, 3);
  buffer.writeUInt32LE(7, 4);
  buffer.writeUInt32LE(options.blockSequence || 1, 8);
  buffer.writeUInt32LE(options.firstSampleSequence || 0, 12);
  buffer.writeBigUInt64LE(options.timestampNs || 1000000000n, 16);
  buffer.writeUInt16LE(130, 24);
  buffer.writeUInt16LE(samples.length, 26);
  buffer.writeUInt16LE(0, 28);
  buffer.writeUInt16LE(32, 30);
  samples.forEach((value, index) => buffer.writeInt32LE(value, 32 + index * 4));
  return buffer;
}

test('decodes SampleBlock V1 and rejects malformed payloads', () => {
  const block = decodeSampleBlock(encode([-120, 450, -33], {flags: 1}));
  assert.equal(block.newSession, true);
  assert.deepEqual(block.samples, [-120, 450, -33]);
  assert.equal(block.sampleRateHz, 130);
  assert.throws(() => decodeSampleBlock(Buffer.alloc(12)), /short header/);
  const invalid = encode([1]); invalid[2] = 2;
  assert.throws(() => decodeSampleBlock(invalid), /bad version/);
});

test('detects periodic synthetic R peaks and computes RR/BPM', () => {
  const processor = new EcgProcessor();
  const allPeaks = [];
  let sequence = 0;
  for (let blockIndex = 0; blockIndex < 24; blockIndex++) {
    const samples = Array.from({length: 33}, (_, index) => {
      const position = sequence + index;
      const phase = position % 130;
      if (phase === 64) return 1400;
      if (phase === 65) return -350;
      return Math.round(25 * Math.sin(position / 17));
    });
    const block = decodeSampleBlock(encode(samples, {
      flags: blockIndex === 0 ? 1 : 0,
      blockSequence: blockIndex + 1,
      firstSampleSequence: sequence,
      timestampNs: 1000000000n + BigInt(Math.round(sequence * 1e9 / 130)),
    }));
    allPeaks.push(...processor.processBlock(block).peaks);
    sequence += samples.length;
  }
  const metrics = processor.metrics();
  assert.ok(allPeaks.length >= 5 && allPeaks.length <= 7, `${allPeaks.length} peaks`);
  assert.ok(metrics.bpm >= 58 && metrics.bpm <= 62, `${metrics.bpm} bpm`);
  assert.ok(metrics.latestRrMs >= 990 && metrics.latestRrMs <= 1010);
});

test('NEW_SESSION resets detector history', () => {
  const processor = new EcgProcessor();
  processor.rPeaks = 4;
  processor.processBlock(decodeSampleBlock(encode(new Array(10).fill(0), {flags: 1})));
  assert.equal(processor.metrics().rPeaks, 0);
  assert.equal(processor.metrics().latestRrMs, null);
});

test('a sequence gap resets QRS and RR history', () => {
  const processor = new EcgProcessor();
  processor.rPeaks = 7;
  processor.rr = [800, 810];
  const block = decodeSampleBlock(encode(new Array(10).fill(0)));
  block.gap = true;
  processor.processBlock(block);
  assert.equal(processor.metrics().rPeaks, 0);
  assert.equal(processor.metrics().rrMeanMs, null);
});
