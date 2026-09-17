# ESPway SampleBlock V1

SampleBlock is a transport-independent binary format for uniformly sampled
signed measurements. All multibyte integers are little-endian. ECG samples
are signed `int32_t` values in microvolts. A C++ structure must never be copied
directly to the wire.

## SampleBlock

| Offset | Size | Field |
|---:|---:|---|
| 0 | 2 | magic `0xEC01` |
| 2 | 1 | version `1` |
| 3 | 1 | flags (`0x01` = `NEW_SESSION`) |
| 4 | 4 | source ID |
| 8 | 4 | block sequence |
| 12 | 4 | first sample sequence |
| 16 | 8 | first sample source timestamp, ns |
| 24 | 2 | sample rate, Hz |
| 26 | 2 | sample count |
| 28 | 2 | samples dropped before this block |
| 30 | 2 | header size, `32` |
| 32 | 4 × count | signed `int32` samples |

The Polar ECG builder alternates targets of 32 and 33 samples. Each pair is
65 samples (0.5 s) and each four blocks are exactly 130 samples (1 s), so the
nominal 250 ms granularity introduces no cumulative drift.

The first completed block is marked `NEW_SESSION`. A Polar reconnect changes
the ECG session sequence; the builder discards any partial block, restarts the
32/33 pattern and marks the next completed block `NEW_SESSION`. Block sequence
numbers remain monotonic across sessions. Sample sequence and the first-sample
timestamp come from `PolarH10Client`.

## Recent-block ring

The Polar example retains 16 completed blocks, approximately four seconds.
Insertion never waits for HTTP. When full, the newest block overwrites the
oldest and increments the overwrite counter.

## HTTP polling

```text
GET /api/polar/ecg/blocks?after=<blockSequence>&max=<count>
```

`after=0` starts at the oldest retained block. `max` defaults to 4 and is
clamped to 1..4. HTTP always returns status 200 and
`application/octet-stream`, including when no new block exists. Polling is not
long polling.

The 24-byte response header is followed by zero or more records. Each record
is a little-endian `uint16` block length followed by one SampleBlock.

| Offset | Size | Field |
|---:|---:|---|
| 0 | 2 | response magic `0xEC02` |
| 2 | 1 | version `1` |
| 3 | 1 | flags (`0x01` = `GAP`) |
| 4 | 2 | response header size, `24` |
| 6 | 2 | block count |
| 8 | 4 | oldest available block sequence, or 0 |
| 12 | 4 | newest available block sequence, or 0 |
| 16 | 4 | requested `after` value |
| 20 | 4 | first returned block sequence, or 0 |

`GAP` is set when `after + 1` predates the oldest retained block. The Polar
endpoint also sets it and returns the oldest retained blocks when `after` is
greater than the current newest sequence, which lets a persistent browser
recover after an ESP restart resets the in-memory producer sequence. A
consumer uses block sequence—not timestamp—to reject duplicates and detect
missing blocks. It reconstructs intermediate timestamps from the first
timestamp and sample rate.

The same binary body is sent directly on LAN. ESPway's existing projected-page
tunnel already Base64-encodes HTTP response chunks, so no ECG-specific
WebSocket or tunnel change is required.
