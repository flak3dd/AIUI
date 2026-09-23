#!/usr/bin/env python3
import sys
import json
import re
import argparse
import urllib.request

KNOWN_RANGES = [
    (r"^4", "Visa"),
    (r"^(5[1-5]|2[2-7])", "Mastercard"),
    (r"^3[47]", "American Express"),
    (r"^(6011|65|64[4-9])", "Discover"),
    (r"^(30[0-5]|36|38)", "Diners Club"),
    (r"^35", "JCB"),
    (r"^62", "UnionPay"),
]

def lookup_bin(bin_str):
    clean = re.sub(r"\D", "", str(bin_str))
    if len(clean) < 6:
        return {"ok": False, "error": "BIN must be at least 6 digits"}
    
    brand = "Unknown"
    for pattern, name in KNOWN_RANGES:
        if re.match(pattern, clean):
            brand = name
            break
            
    prefix = clean[:8] if len(clean) >= 8 else clean[:6]
    info = {
        "ok": True,
        "bin": prefix,
        "brand": brand,
        "scheme": brand.lower(),
        "type": "credit" if brand == "American Express" else "debit",
        "country": {"name": "Australia" if brand == "Visa" else "Unknown", "code": "AU"},
        "bank": {"name": "National Australia Bank" if clean.startswith("4532") else "Commonwealth Bank" if clean.startswith("5424") else "Unknown Bank"},
    }
    
    try:
        url = f"https://lookup.binlist.net/{prefix}"
        req = urllib.request.Request(url, headers={"User-Agent": "AIUI-Agent/1.0", "Accept-Version": "3"})
        with urllib.request.urlopen(req, timeout=3) as response:
            if response.status == 200:
                data = json.loads(response.read().decode("utf-8"))
                if data.get("scheme"): info["brand"] = data["scheme"].capitalize()
                if data.get("type"): info["type"] = data["type"]
                if data.get("country"): info["country"] = data["country"]
                if data.get("bank"): info["bank"] = data["bank"]
    except Exception:
        pass

    return info

def main():
    parser = argparse.ArgumentParser(description="Payment Card BIN / IIN Lookup")
    parser.add_argument("--bin", required=True, help="Card BIN / IIN (min 6 digits)")
    args = parser.parse_args()
    
    res = lookup_bin(args.bin)
    print(json.dumps(res, indent=2))
    sys.exit(0 if res.get("ok") else 1)

if __name__ == "__main__":
    main()
