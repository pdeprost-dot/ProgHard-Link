'use strict';

class EcgProcessor {
  constructor() { this.reset(); }

  reset() {
    this.sampleRate = 130;
    this.previousRaw = 0;
    this.highPass = 0;
    this.lowPass = 0;
    this.previousFiltered = 0;
    this.energyWindow = [];
    this.energySum = 0;
    this.signalLevel = 1;
    this.noiseLevel = 0;
    this.previousEnergy = 0;
    this.ring = [];
    this.lastPeakTimestampNs = null;
    this.rr = [];
    this.rPeaks = 0;
    this.bpm = null;
    this.latestRrMs = null;
  }

  processBlock(block) {
    if (block.newSession || block.gap) this.reset();
    this.sampleRate = block.sampleRateHz;
    const dt = 1 / this.sampleRate;
    const hpAlpha = (1 / (2 * Math.PI * 0.7)) / ((1 / (2 * Math.PI * 0.7)) + dt);
    const lpAlpha = dt / ((1 / (2 * Math.PI * 25)) + dt);
    const integrationSamples = Math.max(5, Math.round(this.sampleRate * 0.12));
    const output = [];
    const peaks = [];

    block.samples.forEach((raw, index) => {
      this.highPass = hpAlpha * (this.highPass + raw - this.previousRaw);
      this.previousRaw = raw;
      this.lowPass += lpAlpha * (this.highPass - this.lowPass);
      const filtered = this.lowPass;
      const derivative = filtered - this.previousFiltered;
      this.previousFiltered = filtered;
      const energy = derivative * derivative;
      this.energyWindow.push(energy);
      this.energySum += energy;
      if (this.energyWindow.length > integrationSamples)
        this.energySum -= this.energyWindow.shift();
      const integrated = this.energySum / this.energyWindow.length;
      const timestampNs = block.firstSampleTimestampNs +
        BigInt(Math.round(index * 1e9 / this.sampleRate));
      const point = {
        sequence: block.firstSampleSequence + index,
        timestampNs,
        raw,
        filtered: Math.round(filtered),
      };
      this.ring.push({...point, integrated});
      if (this.ring.length > integrationSamples * 2) this.ring.shift();

      const threshold = this.noiseLevel + 0.30 * (this.signalLevel - this.noiseLevel);
      const localMaximum = this.previousEnergy > integrated;
      const candidateEnergy = this.previousEnergy;
      const refractoryNs = 250000000n;
      const outsideRefractory = this.lastPeakTimestampNs === null ||
        timestampNs - this.lastPeakTimestampNs > refractoryNs;
      if (localMaximum && candidateEnergy > Math.max(threshold, 4) && outsideRefractory) {
        const search = this.ring.slice(-integrationSamples);
        const peak = search.reduce((best, item) =>
          Math.abs(item.filtered) > Math.abs(best.filtered) ? item : best, search[0]);
        if (this.lastPeakTimestampNs === null ||
            peak.timestampNs - this.lastPeakTimestampNs > refractoryNs) {
          this.acceptPeak(peak);
          peaks.push({
            sequence: peak.sequence,
            timestampNs: peak.timestampNs.toString(),
            value: peak.raw,
            filtered: peak.filtered,
            rrMs: this.latestRrMs,
            bpm: this.bpm,
          });
        }
        this.signalLevel = 0.125 * candidateEnergy + 0.875 * this.signalLevel;
      } else {
        this.noiseLevel = 0.02 * integrated + 0.98 * this.noiseLevel;
      }
      this.previousEnergy = integrated;
      output.push({
        sequence: point.sequence,
        timestampNs: timestampNs.toString(),
        raw,
        filtered: point.filtered,
      });
    });
    return {samples: output, peaks, metrics: this.metrics()};
  }

  acceptPeak(peak) {
    if (this.lastPeakTimestampNs !== null) {
      const rrMs = Number(peak.timestampNs - this.lastPeakTimestampNs) / 1e6;
      if (rrMs >= 300 && rrMs <= 2000) {
        this.latestRrMs = Math.round(rrMs);
        this.rr.push(rrMs);
        if (this.rr.length > 12) this.rr.shift();
        if (this.rr.length >= 3) {
          const recent = this.rr.slice(-5).sort((a, b) => a - b);
          const median = recent[Math.floor(recent.length / 2)];
          this.bpm = Math.round(60000 / median);
        }
      }
    }
    this.lastPeakTimestampNs = peak.timestampNs;
    this.rPeaks++;
  }

  metrics() {
    const mean = this.rr.length
      ? this.rr.reduce((sum, value) => sum + value, 0) / this.rr.length : null;
    return {
      rPeaks: this.rPeaks,
      bpm: this.bpm,
      latestRrMs: this.latestRrMs,
      rrMeanMs: mean === null ? null : Math.round(mean),
      rrMinMs: this.rr.length ? Math.round(Math.min(...this.rr)) : null,
      rrMaxMs: this.rr.length ? Math.round(Math.max(...this.rr)) : null,
    };
  }
}

module.exports = {EcgProcessor};
