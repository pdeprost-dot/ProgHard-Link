#!/usr/bin/env python3
"""Poll and validate ESPway SampleBlock V1 ECG responses."""

import argparse
import struct
import time
import urllib.request

RESPONSE = struct.Struct("<HBBHHIIII")
BLOCK = struct.Struct("<HBBIIIQHHHH")


def fetch(base_url: str, after: int, maximum: int, timeout: float):
    url = f"{base_url}/api/polar/ecg/blocks?after={after}&max={maximum}"
    started = time.perf_counter()
    with urllib.request.urlopen(url, timeout=timeout) as response:
        body = response.read()
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status}")
        if response.headers.get_content_type() != "application/octet-stream":
            raise RuntimeError("unexpected content type")
    latency_ms = (time.perf_counter() - started) * 1000
    if len(body) < RESPONSE.size:
        raise RuntimeError("truncated response header")
    magic, version, flags, header_size, count, oldest, newest, requested, first = RESPONSE.unpack_from(body)
    if (magic, version, header_size) != (0xEC02, 1, RESPONSE.size):
        raise RuntimeError("invalid response header")
    if requested != after:
        raise RuntimeError("server echoed a different after sequence")
    offset = header_size
    blocks = []
    for _ in range(count):
        if offset + 2 > len(body):
            raise RuntimeError("missing block length")
        length = struct.unpack_from("<H", body, offset)[0]
        offset += 2
        if offset + length > len(body) or length < BLOCK.size:
            raise RuntimeError("invalid block length")
        fields = BLOCK.unpack_from(body, offset)
        bmagic, bversion, bflags, source, sequence, first_sample, timestamp, rate, samples_count, dropped, bheader = fields
        if (bmagic, bversion, bheader) != (0xEC01, 1, BLOCK.size):
            raise RuntimeError("invalid SampleBlock header")
        if length != bheader + samples_count * 4 or samples_count not in (32, 33):
            raise RuntimeError("invalid SampleBlock payload size")
        samples = struct.unpack_from(f"<{samples_count}i", body, offset + bheader)
        blocks.append({"flags": bflags, "source": source, "sequence": sequence,
                       "first_sample": first_sample, "timestamp": timestamp,
                       "rate": rate, "count": samples_count, "dropped": dropped,
                       "minimum": min(samples), "maximum": max(samples),
                       "samples": samples})
        offset += length
    if offset != len(body) or (blocks and first != blocks[0]["sequence"]):
        raise RuntimeError("response length/first sequence mismatch")
    return latency_ms, bool(flags & 1), oldest, newest, blocks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://esp-device.local")
    parser.add_argument("--seconds", type=float, default=30)
    parser.add_argument("--interval", type=float, default=0.19)
    parser.add_argument("--max", type=int, default=4)
    parser.add_argument("--after", type=int, default=0)
    parser.add_argument("--pause-after", type=float)
    parser.add_argument("--pause", type=float, default=0)
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--samples-file")
    args = parser.parse_args()
    after = args.after
    requests = errors = received = gaps = 0
    last_sample = last_timestamp = None
    started = time.monotonic()
    paused = False
    latencies = []
    counts = {32: 0, 33: 0}
    new_sessions = 0
    captured_samples = []
    while time.monotonic() - started < args.seconds:
        elapsed = time.monotonic() - started
        if not paused and args.pause_after is not None and elapsed >= args.pause_after:
            print(f"PAUSE {args.pause:.3f}s after={after}")
            time.sleep(args.pause)
            paused = True
        try:
            latency, gap, oldest, newest, blocks = fetch(args.url, after, args.max, 5)
            requests += 1; latencies.append(latency); gaps += int(gap)
            for block_index, block in enumerate(blocks):
                if block["sequence"] <= after:
                    raise RuntimeError("duplicate/out-of-order block")
                if last_sample is not None and not (gap and block_index == 0) and not (block["flags"] & 1):
                    if block["first_sample"] != last_sample:
                        raise RuntimeError("sample sequence discontinuity without NEW_SESSION")
                    expected = last_timestamp + (1_000_000_000 // block["rate"])
                    # Polar packet timestamps follow the sample clock but may
                    # differ by a few tens of microseconds at packet edges.
                    if abs(block["timestamp"] - expected) > 1_000_000:
                        raise RuntimeError("timestamp discontinuity")
                counts[block["count"]] += 1
                new_sessions += int(bool(block["flags"] & 1))
                captured_samples.extend(block["samples"])
                if not args.quiet:
                    print("blockSequence={sequence} firstSampleSequence={first_sample} "
                          "timestampNs={timestamp} samples={count} min={minimum} max={maximum} "
                          "flags=0x{flags:02x} dropped={dropped}".format(**block))
                after = block["sequence"]
                last_sample = block["first_sample"] + block["count"]
                last_timestamp = block["timestamp"] + (block["count"] - 1) * (1_000_000_000 // block["rate"])
                received += 1
            if gap:
                print(f"GAP oldest={oldest} newest={newest} requestedAfter={after}")
        except Exception as error:
            errors += 1
            print(f"ERROR {error}")
        time.sleep(args.interval)
    print(f"SUMMARY requests={requests} errors={errors} blocks={received} gaps={gaps} "
          f"after={after} latencyAvgMs={sum(latencies)/len(latencies):.1f} "
          f"latencyMaxMs={max(latencies):.1f} count32={counts[32]} "
          f"count33={counts[33]} newSessions={new_sessions}")
    if args.samples_file:
        with open(args.samples_file, "w", encoding="ascii", newline="\n") as output:
            output.writelines(f"{value}\n" for value in captured_samples)


if __name__ == "__main__":
    main()
