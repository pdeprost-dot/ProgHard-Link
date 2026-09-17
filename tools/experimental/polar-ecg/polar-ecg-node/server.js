'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const {decodeSampleBlock} = require('./sampleblock/decoder');
const {EcgProcessor} = require('./ecg/processor');
const {MqttTransport} = require('./mqtt/transport');

const index = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const clients = new Set();
const processor = new EcgProcessor();
const transport = new MqttTransport(config.mqtt);
const state = {
  mqtt: false, polar: 'unknown', ecg: 'unknown', mqttEcgEnabled: 'unknown',
  polarBpm: null, polarRrMs: null, blockSequence: null,
  expectedSampleSequence: null, lastSampleSequence: null,
  blocks: 0, samples: 0, blockGaps: 0, sampleGaps: 0,
  duplicates: 0, invalid: 0, announcedDropped: 0, newSessions: 0,
  mqttReconnects: 0, startedAt: Date.now(), firstSourceNs: null,
  lastSourceNs: null, sourceSamples: 0, qrs: processor.metrics(),
  polarBpmMin: null, polarBpmMax: null, ecgBpmMin: null, ecgBpmMax: null,
  bpmDifferenceSum: 0, bpmDifferenceCount: 0,
  rrDifferenceSum: 0, rrDifferenceCount: 0,
};

function broadcast(type, data) {
  const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const response of clients) response.write(line);
}

function publicConfig() {
  return {mqtt: {
    host: config.mqtt.host, port: config.mqtt.port,
    deviceId: config.mqtt.deviceId, baseTopic: config.mqtt.topicRoot,
    connected: state.mqtt,
  }};
}

function summary() {
  const durationSeconds = Math.max(0.001, (Date.now() - state.startedAt) / 1000);
  let rate = 0;
  if (state.firstSourceNs !== null && state.lastSourceNs > state.firstSourceNs)
    rate = (state.sourceSamples - 1) * 1e9 /
      Number(state.lastSourceNs - state.firstSourceNs);
  return {
    ...state, firstSourceNs: state.firstSourceNs?.toString() ?? null,
    lastSourceNs: state.lastSourceNs?.toString() ?? null, durationSeconds, rate,
    meanBpmDifference: state.bpmDifferenceCount
      ? state.bpmDifferenceSum / state.bpmDifferenceCount : null,
    meanRrDifferenceMs: state.rrDifferenceCount
      ? state.rrDifferenceSum / state.rrDifferenceCount : null,
  };
}

function resetContinuity() {
  state.blockSequence = null;
  state.expectedSampleSequence = null;
  state.firstSourceNs = null;
  state.lastSourceNs = null;
  state.sourceSamples = 0;
  processor.reset();
  state.qrs = processor.metrics();
}

function updateRange(prefix, value) {
  if (!Number.isFinite(value)) return;
  const min = `${prefix}Min`, max = `${prefix}Max`;
  state[min] = state[min] === null ? value : Math.min(state[min], value);
  state[max] = state[max] === null ? value : Math.max(state[max], value);
}

function onBlock(payload) {
  let block;
  try { block = decodeSampleBlock(payload); }
  catch (error) {
    state.invalid++;
    console.error('Invalid block:', error.message);
    return;
  }
  if (block.newSession) {
    state.newSessions++;
    resetContinuity();
  }
  const blockGap = state.blockSequence !== null &&
    block.blockSequence !== state.blockSequence + 1;
  if (state.blockSequence !== null && block.blockSequence === state.blockSequence) {
    state.duplicates++;
    return;
  }
  if (blockGap) state.blockGaps++;
  const sampleGap = state.expectedSampleSequence !== null &&
    block.firstSampleSequence !== state.expectedSampleSequence;
  if (sampleGap) state.sampleGaps++;
  block.gap = blockGap || sampleGap;
  if (block.gap) processor.reset();

  const processed = processor.processBlock(block);
  state.blockSequence = block.blockSequence;
  state.expectedSampleSequence = block.firstSampleSequence + block.sampleCount;
  state.lastSampleSequence = state.expectedSampleSequence - 1;
  state.blocks++;
  state.samples += block.sampleCount;
  state.sourceSamples += block.sampleCount;
  state.announcedDropped += block.samplesDroppedBeforeBlock;
  const lastNs = block.firstSampleTimestampNs +
    BigInt(Math.round((block.sampleCount - 1) * 1e9 / block.sampleRateHz));
  if (state.firstSourceNs === null) state.firstSourceNs = block.firstSampleTimestampNs;
  state.lastSourceNs = lastNs;
  state.qrs = processed.metrics;
  updateRange('ecgBpm', state.qrs.bpm);
  if (processed.peaks.length && state.polarBpm && state.qrs.bpm) {
    state.bpmDifferenceSum += Math.abs(state.qrs.bpm - state.polarBpm);
    state.bpmDifferenceCount++;
  }
  if (processed.peaks.length && state.polarRrMs && state.qrs.latestRrMs) {
    state.rrDifferenceSum += Math.abs(state.qrs.latestRrMs - state.polarRrMs);
    state.rrDifferenceCount++;
  }
  broadcast('block', {
    blockSequence: block.blockSequence,
    firstSampleSequence: block.firstSampleSequence,
    sampleRateHz: block.sampleRateHz, sampleCount: block.sampleCount,
    samplesDroppedBeforeBlock: block.samplesDroppedBeforeBlock,
    gap: block.gap, samples: processed.samples, peaks: processed.peaks,
  });
}

transport.on('connect', reconnect => {
  state.mqtt = true;
  if (reconnect) state.mqttReconnects++;
  broadcast('status', summary());
});
transport.on('disconnect', () => {
  state.mqtt = false;
  broadcast('status', summary());
});
transport.on('transportError', error => console.error('MQTT:', error.message));
transport.on('message', (topic, payload) => {
  if (topic === 'polar/ecg/block') return onBlock(payload);
  const value = payload.toString();
  if (topic === 'polar/status') state.polar = value;
  else if (topic === 'polar/ecg/status') state.ecg = value;
  else if (topic === 'polar/ecg/mqtt_enabled') state.mqttEcgEnabled = value;
  else if (topic === 'polar/heart_rate') {
    state.polarBpm = Number(value);
    updateRange('polarBpm', state.polarBpm);
  } else if (topic === 'polar/rr') state.polarRrMs = Number(value);
  broadcast('status', summary());
});
transport.start();

setInterval(() => {
  const current = summary();
  console.log(
    `duration=${current.durationSeconds.toFixed(1)}s blocks=${state.blocks} ` +
    `samples=${state.samples} rate=${current.rate.toFixed(2)}Hz ` +
    `R=${state.qrs.rPeaks} polar=${state.polarBpm ?? '-'} ` +
    `ecg=${state.qrs.bpm ?? '-'} rr=${state.qrs.latestRrMs ?? '-'}ms ` +
    `gaps=${state.blockGaps}/${state.sampleGaps} invalid=${state.invalid}`
  );
  broadcast('status', current);
}, 10000);

const server = http.createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end(index);
  } else if (request.url === '/api/status' || request.url === '/api/ecg/status') {
    response.writeHead(200, {'content-type': 'application/json'});
    response.end(JSON.stringify(summary()));
  } else if (request.url === '/api/config') {
    response.writeHead(200, {'content-type': 'application/json'});
    response.end(JSON.stringify(publicConfig()));
  } else if (request.url === '/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache',
      connection: 'keep-alive', 'access-control-allow-origin': '*',
    });
    clients.add(response);
    response.write(`event: status\ndata: ${JSON.stringify(summary())}\n\n`);
    request.on('close', () => clients.delete(response));
  } else {
    response.writeHead(404);
    response.end('Not found');
  }
});

server.listen(config.http.port, '127.0.0.1', () => console.log(
  `Cardio monitor: http://localhost:${config.http.port} ` +
  `(mqtt://${config.mqtt.host}:${config.mqtt.port}, ${config.mqtt.baseTopic})`
));

function stop() {
  transport.stop(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
