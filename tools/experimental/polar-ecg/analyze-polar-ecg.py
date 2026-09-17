import json
import math
import statistics
from pathlib import Path

FS = 130.0
ROOT = Path(__file__).resolve().parents[1]
values = [int(line.strip()) for line in (ROOT / "polar_ecg_capture.txt").read_text().splitlines() if line.strip()]
meta = json.loads((ROOT / "polar_ecg_capture_meta.json").read_text(encoding="utf-8-sig"))
n = len(values)
diffs = [b - a for a, b in zip(values, values[1:])]

def percentile(xs, p):
    ys = sorted(xs)
    pos = (len(ys) - 1) * p
    lo = int(math.floor(pos)); hi = int(math.ceil(pos))
    return ys[lo] if lo == hi else ys[lo] * (hi - pos) + ys[hi] * (pos - lo)

def summary(xs):
    med = statistics.median(xs)
    mad = statistics.median(abs(x - med) for x in xs)
    return {
        "min": min(xs), "max": max(xs), "mean": statistics.fmean(xs),
        "median": med, "std_population": statistics.pstdev(xs), "mad": mad,
        "q01": percentile(xs, .01), "q05": percentile(xs, .05),
        "q25": percentile(xs, .25), "q75": percentile(xs, .75),
        "q95": percentile(xs, .95), "q99": percentile(xs, .99),
    }

stats = summary(values)
diff_stats = summary(diffs)

# Robust outlier and discontinuity screens. These identify candidates, not clinical events.
iqr = stats["q75"] - stats["q25"]
outlier_low = stats["q25"] - 3 * iqr
outlier_high = stats["q75"] + 3 * iqr
outlier_indices = [i for i, v in enumerate(values) if v < outlier_low or v > outlier_high]
diff_abs = [abs(x) for x in diffs]
diff_med = statistics.median(diff_abs)
diff_mad = statistics.median(abs(x - diff_med) for x in diff_abs)
disc_threshold = max(percentile(diff_abs, .995), diff_med + 10 * diff_mad)
discontinuities = [i + 1 for i, d in enumerate(diffs) if abs(d) > disc_threshold]

run_records = []
run_start = 0
for i in range(1, n + 1):
    if i == n or values[i] != values[run_start]:
        if i - run_start >= 2:
            run_records.append({"value": values[run_start], "start": run_start, "length": i - run_start})
        run_start = i
run_records.sort(key=lambda r: r["length"], reverse=True)
phase_counts = {}
for i in discontinuities:
    phase_counts[str(i % 73)] = phase_counts.get(str(i % 73), 0) + 1
hist_edges = [-math.inf, -15000, -10000, -5000, -2000, -1000, 0, 1000, 2000, 5000, 10000, 15000, math.inf]
histogram = []
for lo, hi in zip(hist_edges, hist_edges[1:]):
    count = sum(lo <= v < hi for v in values)
    histogram.append({"lower": None if math.isinf(lo) else lo, "upper": None if math.isinf(hi) else hi,
                      "count": count, "percent": 100 * count / n})

# Autocorrelation over physiologically plausible heart periods (30–200 BPM).
centered = [x - stats["mean"] for x in values]
den = sum(x * x for x in centered)
ac = []
for lag in range(39, 261):
    corr = sum(centered[i] * centered[i - lag] for i in range(lag, n)) / den
    ac.append((corr, lag))
best_corr, best_lag = max(ac)

# Candidate peaks based on absolute deviation, local maxima and 300 ms refractory period.
baseline_window = 65
filtered = []
for i, v in enumerate(values):
    lo = max(0, i - baseline_window // 2); hi = min(n, i + baseline_window // 2 + 1)
    filtered.append(v - statistics.median(values[lo:hi]))
absf = [abs(x) for x in filtered]
af_med = statistics.median(absf)
af_mad = statistics.median(abs(x - af_med) for x in absf)
peak_threshold = af_med + 5 * af_mad
candidates = [i for i in range(1, n - 1) if absf[i] >= peak_threshold and absf[i] >= absf[i-1] and absf[i] > absf[i+1]]
peaks = []
for i in candidates:
    if not peaks or i - peaks[-1] >= int(.30 * FS):
        peaks.append(i)
    elif absf[i] > absf[peaks[-1]]:
        peaks[-1] = i
rr = [(b - a) / FS for a, b in zip(peaks, peaks[1:])]

report = {
    "sample_count": n,
    "wall_clock_seconds": meta["wall_clock_seconds"],
    "effective_lines_per_second": n / meta["wall_clock_seconds"],
    "duration_at_130_hz_seconds": (n - 1) / FS,
    "signal_uv": stats,
    "successive_differences_uv": diff_stats,
    "outlier_rule": {"lower": outlier_low, "upper": outlier_high, "count": len(outlier_indices), "indices_first_30": outlier_indices[:30]},
    "discontinuity_rule": {"abs_diff_threshold": disc_threshold, "count": len(discontinuities), "indices_first_30": discontinuities[:30]},
    "longest_constant_runs": run_records[:20],
    "histogram_uv": histogram,
    "exact_clip_like_values": {"-19766": values.count(-19766), "19764": values.count(19764)},
    "discontinuity_phases_modulo_73": phase_counts,
    "autocorrelation": {"best_lag_samples": best_lag, "period_seconds": best_lag / FS, "equivalent_bpm": 60 * FS / best_lag, "coefficient": best_corr},
    "qrs_candidates": {"threshold_abs_detrended_uv": peak_threshold, "count": len(peaks), "indices": peaks, "times_seconds": [i / FS for i in peaks], "median_rr_seconds": statistics.median(rr) if rr else None, "equivalent_bpm": 60 / statistics.median(rr) if rr else None},
    "representative_values_first_60": values[:60],
}
(ROOT / "polar_ecg_analysis.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

# Dependency-free SVG of the first 10 seconds.
shown = values[:int(10 * FS)]
W, H = 1400, 700
L, R, T, B = 92, 28, 56, 72
pw, ph = W - L - R, H - T - B
ymin, ymax = min(shown), max(shown)
ypad = max(1, (ymax - ymin) * .08)
ymin -= ypad; ymax += ypad
def xpx(i): return L + i / (len(shown) - 1) * pw
def ypx(v): return T + (ymax - v) / (ymax - ymin) * ph
points = " ".join(f"{xpx(i):.2f},{ypx(v):.2f}" for i, v in enumerate(shown))
parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         '<rect width="100%" height="100%" fill="#fbfcfe"/>',
         '<style>text{font-family:Segoe UI,Arial,sans-serif;fill:#273142}.tick{font-size:14px}.title{font-size:22px;font-weight:600}.sub{font-size:14px;fill:#5f6b7a}</style>',
         '<text x="92" y="30" class="title">Polar H10 — ECG brut, 10 premières secondes</text>',
         '<text x="92" y="50" class="sub">Valeurs exactes émises par ESP32-C3 · axe temporel calculé à 130 Hz · unité µV</text>']
for sec in range(0, 11):
    x = L + sec / 10 * pw
    parts.append(f'<line x1="{x}" y1="{T}" x2="{x}" y2="{T+ph}" stroke="#dfe5ec"/>')
    parts.append(f'<text x="{x}" y="{T+ph+28}" text-anchor="middle" class="tick">{sec}</text>')
for j in range(6):
    val = ymin + j / 5 * (ymax - ymin)
    y = ypx(val)
    parts.append(f'<line x1="{L}" y1="{y}" x2="{L+pw}" y2="{y}" stroke="#dfe5ec"/>')
    parts.append(f'<text x="{L-12}" y="{y+5}" text-anchor="end" class="tick">{val:.0f}</text>')
if ymin <= 0 <= ymax:
    y0 = ypx(0)
    parts.append(f'<line x1="{L}" y1="{y0}" x2="{L+pw}" y2="{y0}" stroke="#6b7280" stroke-width="1.5"/>')
parts.append(f'<polyline points="{points}" fill="none" stroke="#1468a8" stroke-width="1.35" stroke-linejoin="round" stroke-linecap="round"/>')
parts.append(f'<text x="{L+pw/2}" y="{H-18}" text-anchor="middle" class="tick">Temps (s)</text>')
parts.append(f'<text x="20" y="{T+ph/2}" text-anchor="middle" class="tick" transform="rotate(-90 20 {T+ph/2})">ECG (µV)</text>')
parts.append('</svg>')
(ROOT / "polar_ecg_first_10s.svg").write_text("\n".join(parts), encoding="utf-8")
print(json.dumps(report, indent=2))
