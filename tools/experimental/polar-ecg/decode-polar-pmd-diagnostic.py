import re
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / "polar_pmd_raw_capture.txt"
target = ROOT / "polar_ecg_diagnostic.txt"
pattern = re.compile(
    r"^PMD_RAW seq_first=(\d+) len=(\d+) timestamp=(\d+) "
    r"frame=0x([0-9A-Fa-f]{2}) samples=(\d+) hex=([0-9A-Fa-f]+)$"
)

def signed24(b):
    value = b[0] | (b[1] << 8) | (b[2] << 16)
    return value - (1 << 24) if value & 0x800000 else value

packets = []
for line in source.read_text(encoding="utf-8").splitlines():
    match = pattern.match(line.strip())
    if not match:
        continue
    seq, declared_len, timestamp, frame, declared_count, hex_data = match.groups()
    raw = bytes.fromhex(hex_data)
    decoded_timestamp = int.from_bytes(raw[1:9], "little")
    packets.append({
        "seq": int(seq), "declared_len": int(declared_len), "timestamp": int(timestamp),
        "frame": int(frame, 16), "declared_count": int(declared_count), "raw": raw,
        "decoded_timestamp": decoded_timestamp,
    })

period_ns = 1_000_000_000 // 130
out = []
out.append("Polar H10 PMD ECG diagnostic capture — exact raw packets plus independent PC decode")
out.append("No filtering, smoothing, scaling, or byte transformation was applied to sample values.")
out.append("")
for packet_index, p in enumerate(packets):
    raw = p["raw"]
    actual_count = (len(raw) - 10) // 3
    remainder = (len(raw) - 10) % 3
    out.append(
        f"PACKET {packet_index} seq_first={p['seq']} len_declared={p['declared_len']} "
        f"len_observed={len(raw)} measurement=0x{raw[0]:02X} "
        f"timestamp_bytes={raw[1:9].hex().upper()} timestamp_le={p['decoded_timestamp']} "
        f"frame_byte=0x{raw[9]:02X} compressed={(raw[9] & 0x80) != 0} "
        f"frame_type={raw[9] & 0x7F} samples_declared={p['declared_count']} "
        f"samples_observed={actual_count} payload_remainder={remainder}"
    )
    out.append(f"RAW_HEX {raw.hex().upper()}")
    for i in range(actual_count):
        pos = 10 + i * 3
        sample_bytes = raw[pos:pos+3]
        value = signed24(sample_bytes)
        sample_timestamp = p["decoded_timestamp"] - (actual_count - 1 - i) * period_ns
        out.append(
            f"SAMPLE packet={packet_index} packet_index={i} sequence={p['seq'] + i} "
            f"polar_ns={sample_timestamp} bytes={sample_bytes.hex().upper()} ecg_uv={value}"
        )
    out.append("")

if packets:
    out.append("PACKET_INTERVALS")
    for i in range(1, len(packets)):
        delta = packets[i]["decoded_timestamp"] - packets[i-1]["decoded_timestamp"]
        seq_delta = packets[i]["seq"] - packets[i-1]["seq"]
        previous_count = (len(packets[i-1]["raw"]) - 10) // 3
        out.append(
            f"from={i-1} to={i} timestamp_delta_ns={delta} sequence_delta={seq_delta} "
            f"previous_samples={previous_count} sequence_gap={seq_delta - previous_count}"
        )

target.write_text("\n".join(out) + "\n", encoding="utf-8")
all_values = []
packet_summaries = []
for packet_index, p in enumerate(packets):
    raw = p["raw"]
    vals = [signed24(raw[pos:pos+3]) for pos in range(10, len(raw), 3)]
    all_values.extend(vals)
    packet_summaries.append({
        "packet": packet_index, "length": len(raw), "samples": len(vals),
        "sequence_first": p["seq"], "timestamp": p["decoded_timestamp"],
        "min_uv": min(vals), "max_uv": max(vals),
    })
intervals = [packets[i]["decoded_timestamp"] - packets[i-1]["decoded_timestamp"] for i in range(1, len(packets))]
diag_summary = {
    "packet_count": len(packets), "sample_count": len(all_values),
    "packet_lengths": sorted(set(len(p["raw"]) for p in packets)),
    "samples_per_packet": sorted(set((len(p["raw"])-10)//3 for p in packets)),
    "measurement_types": sorted(set(p["raw"][0] for p in packets)),
    "frame_bytes": sorted(set(p["raw"][9] for p in packets)),
    "sequence_gaps": [packets[i]["seq"] - packets[i-1]["seq"] - ((len(packets[i-1]["raw"])-10)//3) for i in range(1, len(packets))],
    "timestamp_interval_ns_mean": statistics.fmean(intervals) if intervals else None,
    "effective_sample_rate_from_polar_timestamps_hz": (73 * 1e9 / statistics.fmean(intervals)) if intervals else None,
    "min_uv": min(all_values), "max_uv": max(all_values),
    "packet_summaries": packet_summaries,
}
(ROOT / "polar_pmd_diagnostic_summary.json").write_text(json.dumps(diag_summary, indent=2), encoding="utf-8")
print(f"packets={len(packets)} samples={sum((len(p['raw'])-10)//3 for p in packets)} output={target}")
