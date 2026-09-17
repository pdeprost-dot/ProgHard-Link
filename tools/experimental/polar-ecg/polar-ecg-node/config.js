'use strict';

const fs = require('fs');
const path = require('path');

function loadDotEnv(file = path.join(__dirname, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const sourceLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function integer(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error(`${name} must be an integer from 1 to 65535`);
  return value;
}

loadDotEnv();
const mqttHost = process.env.MQTT_HOST || 'broker.lan';
const mqttPort = integer('MQTT_PORT', 1883);
const deviceId = process.env.MQTT_DEVICE_ID || 'esp-a1b2c3';
const topicRoot = (process.env.MQTT_BASE_TOPIC || 'espway').replace(/\/+$/, '');

module.exports = {
  mqtt: {
    host: mqttHost,
    port: mqttPort,
    username: process.env.MQTT_USERNAME || '',
    password: process.env.MQTT_PASSWORD || '',
    deviceId,
    topicRoot,
    baseTopic: `${topicRoot}/${deviceId}`,
  },
  http: {port: integer('HTTP_PORT', 3000)},
};
