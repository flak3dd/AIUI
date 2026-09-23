#!/usr/bin/env python3
import sys
import csv
import json
import argparse
from pathlib import Path

def analyze_csv(filepath, delimiter=','):
    if filepath == '--inline-test':
        sample_data = "id,name,score\n1,Alice,95.5\n2,Bob,82.0\n3,Charlie,null\n"
        reader = csv.DictReader(sample_data.strip().splitlines(), delimiter=delimiter)
        rows = list(reader)
    else:
        p = Path(filepath).resolve()
        if not p.exists():
            return {"ok": False, "error": f"File not found: {filepath}"}
        with open(p, 'r', encoding='utf-8', errors='ignore') as f:
            reader = csv.DictReader(f, delimiter=delimiter)
            rows = list(reader)

    if not rows:
        return {"ok": True, "rowCount": 0, "headers": [], "summary": {}}

    headers = list(rows[0].keys())
    col_stats = {}
    for h in headers:
        values = [r[h] for r in rows if r[h] is not None and r[h] != '']
        null_count = len(rows) - len(values)
        num_vals = []
        for v in values:
            try:
                num_vals.append(float(v))
            except ValueError:
                pass
        stat = {
            "totalCount": len(rows),
            "nonEmptyCount": len(values),
            "nullCount": null_count,
            "nullPct": round((null_count / len(rows)) * 100, 2),
            "uniqueCount": len(set(values)),
        }
        if len(num_vals) == len(values) and num_vals:
            stat["isNumeric"] = True
            stat["min"] = min(num_vals)
            stat["max"] = max(num_vals)
            stat["mean"] = round(sum(num_vals) / len(num_vals), 3)
        else:
            stat["isNumeric"] = False
            stat["sampleValues"] = list(set(values))[:5]
        col_stats[h] = stat

    return {
        "ok": True,
        "rowCount": len(rows),
        "headers": headers,
        "columnStatistics": col_stats,
        "sampleFirstRow": rows[0]
    }

def main():
    parser = argparse.ArgumentParser(description="AIUI CSV Statistics Analyzer")
    parser.add_argument("--file-path", required=True, help="Path to CSV file")
    parser.add_argument("--delimiter", default=",", help="Delimiter")
    args = parser.parse_args()

    res = analyze_csv(args.file_path, args.delimiter)
    print(json.dumps(res, indent=2))
    sys.exit(0 if res.get("ok") else 1)

if __name__ == "__main__":
    main()
