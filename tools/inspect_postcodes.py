"""Inspect a downloaded Eurostat postcode CSV before choosing import coverage."""
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

source = Path(__file__).resolve().parents[1] / ".local/gisco/PCODE_PT_2025_4326.csv"
counts, named = Counter(), Counter()
samples = defaultdict(list)
with source.open(encoding="utf-8-sig", newline="") as handle:
    sample = handle.read(8192)
    handle.seek(0)
    reader = csv.DictReader(handle, dialect=csv.Sniffer().sniff(sample, delimiters=",;\t"))
    columns = reader.fieldnames
    for row in reader:
        country = row["CNTR_ID"]
        counts[country] += 1
        named[country] += bool((row.get("LAU_NAME") or "").strip())
        if country in {"HU", "DE", "EL", "UK", "GB", "NO", "LI", "IS", "IE", "NL"} and len(samples[country]) < 3:
            samples[country].append({key: row.get(key) for key in ["POSTCODE", "LAU_NAME", "NUTS3", "NSI_CODE", "LAU_CODE"] if key in row})
report = {"columns": columns, "counts": dict(sorted(counts.items())), "named": dict(sorted(named.items())), "samples": dict(samples)}
(source.parent / "coverage-inspection.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(json.dumps(report, ensure_ascii=True))
