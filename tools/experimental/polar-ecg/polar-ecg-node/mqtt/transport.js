'use strict';

const EventEmitter = require('events');
const mqtt = require('mqtt');

class MqttTransport extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.client = null;
    this.connectedOnce = false;
  }

  start() {
    const options = {reconnectPeriod: 5000};
    if (this.config.username) options.username = this.config.username;
    if (this.config.password) options.password = this.config.password;
    this.client = mqtt.connect(
      `mqtt://${this.config.host}:${this.config.port}`, options
    );
    this.client.on('connect', () => {
      const reconnect = this.connectedOnce;
      this.connectedOnce = true;
      this.client.subscribe([
        `${this.config.baseTopic}/polar/ecg/block`,
        `${this.config.baseTopic}/polar/status`,
        `${this.config.baseTopic}/polar/heart_rate`,
        `${this.config.baseTopic}/polar/rr`,
        `${this.config.baseTopic}/polar/ecg/status`,
        `${this.config.baseTopic}/polar/ecg/mqtt_enabled`,
      ], {qos: 0});
      this.client.publish(
        `${this.config.baseTopic}/polar/ecg/mqtt_enabled/set`, 'on',
        {qos: 0, retain: false}
      );
      this.emit('connect', reconnect);
    });
    this.client.on('reconnect', () => this.emit('disconnect'));
    this.client.on('close', () => this.emit('disconnect'));
    this.client.on('error', error => this.emit('transportError', error));
    this.client.on('message', (topic, payload) =>
      this.emit('message', topic.slice(this.config.baseTopic.length + 1), payload));
  }

  stop(callback) {
    if (!this.client) return callback();
    this.client.publish(
      `${this.config.baseTopic}/polar/ecg/mqtt_enabled/set`, 'off',
      {qos: 0, retain: false}, () => this.client.end(false, callback)
    );
  }
}

module.exports = {MqttTransport};
