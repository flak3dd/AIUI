#!/usr/bin/env python3
import sys
import os
import re
import json
import argparse
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime
from pathlib import Path

OFFLINE_CVE_DB = {
    "CVE-2024-3094": {
        "cveId": "CVE-2024-3094",
        "description": "Malicious code was discovered in the upstream tarballs of xz, starting with version 5.6.0 through 5.6.1. Through a series of complex obfuscations, the liblzma build process extracts a prebuilt object file from a disguised test file existing in the source code, which is then used to modify functions in liblzma code to intercept OpenSSH authentication.",
        "cvss": {"score": 10.0, "severity": "CRITICAL", "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", "version": "3.1"},
        "cwes": ["CWE-506"],
        "published": "2024-03-29T23:15:08.000",
        "source": "NVD (Verified Fallback)",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2024-3094"],
        "affected": ["xz-utils 5.6.0 - 5.6.1", "liblzma 5.6.0 - 5.6.1"]
    },
    "CVE-2021-44228": {
        "cveId": "CVE-2021-44228",
        "description": "Apache Log4j2 JNDI features used in configuration, log messages, and parameters do not protect against attacker controlled LDAP endpoints (Log4Shell).",
        "cvss": {"score": 10.0, "severity": "CRITICAL", "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", "version": "3.1"},
        "cwes": ["CWE-502"],
        "published": "2021-12-10T10:15:00.000",
        "source": "NVD (Verified Fallback)",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2021-44228"],
        "affected": ["Apache Log4j 2.0-beta9 - 2.14.1"]
    }
}

CACHE_FILE = Path(__file__).resolve().parent.parent / "data" / "cve_cache.json"

def load_cache():
    if CACHE_FILE.exists():
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_cache(cache):
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2)
    except Exception:
        pass

def fetch_from_nvd(cve_id=None, keyword=None, max_results=5):
    base_url = "https://services.nvd.nist.gov/rest/json/cves/2.0"
    params = {}
    if cve_id:
        clean_id = cve_id.strip().upper()
        if not clean_id.startswith("CVE-"): clean_id = f"CVE-{clean_id}"
        params["cveId"] = clean_id
    elif keyword:
        params["keywordSearch"] = keyword.strip()
        params["resultsPerPage"] = str(min(max_results, 20))
    else:
        return {"ok": False, "error": "Either cve_id or keyword required"}
    
    url = f"{base_url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "AIUI-Agent/1.0", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                vulns = data.get("vulnerabilities", [])
                results = []
                for item in vulns:
                    c = item.get("cve", {})
                    cid = c.get("id", "UNKNOWN")
                    desc = ""
                    for d in c.get("descriptions", []):
                        if d.get("lang") == "en": desc = d.get("value", ""); break
                    metrics = c.get("metrics", {})
                    cvss = {"score": 0.0, "severity": "UNKNOWN", "vectorString": "", "version": "none"}
                    if "cvssMetricV31" in metrics and metrics["cvssMetricV31"]:
                        m = metrics["cvssMetricV31"][0].get("cvssData", {})
                        cvss = {"score": m.get("baseScore", 0.0), "severity": m.get("baseSeverity", "UNKNOWN"), "vectorString": m.get("vectorString", ""), "version": "3.1"}
                    cwes = [d.get("value", "") for w in c.get("weaknesses", []) for d in w.get("description", []) if d.get("value")]
                    refs = [r.get("url", "") for r in c.get("references", []) if r.get("url")]
                    results.append({"cveId": cid, "description": desc, "cvss": cvss, "cwes": cwes[:3], "published": c.get("published", ""), "source": "NIST NVD API 2.0", "references": refs[:5]})
                return {"ok": True, "totalResults": len(results), "results": results[:max_results]}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def lookup_cve(cve_id=None, keyword=None, max_results=5, min_score=0.0):
    cache = load_cache()
    if cve_id:
        clean = cve_id.strip().upper()
        if not clean.startswith("CVE-"): clean = f"CVE-{clean}"
        if clean in OFFLINE_CVE_DB:
            return {"ok": True, "source": "verified_cache", "totalResults": 1, "results": [OFFLINE_CVE_DB[clean]]}
        if clean in cache:
            return {"ok": True, "source": "disk_cache", "totalResults": 1, "results": [cache[clean]]}
        res = fetch_from_nvd(cve_id=clean)
        if res.get("ok") and res.get("results"):
            cache[clean] = res["results"][0]
            save_cache(cache)
            return {"ok": True, "source": "nvd_api", "totalResults": 1, "results": [res["results"][0]]}
        return {"ok": False, "cveId": clean, "error": f"CVE {clean} not found or rate-limited"}
    
    if keyword:
        res = fetch_from_nvd(keyword=keyword, max_results=max_results)
        if res.get("ok") and res.get("results"):
            results = res["results"]
            if min_score > 0.0:
                results = [r for r in results if r.get("cvss", {}).get("score", 0.0) >= min_score]
            return {"ok": True, "source": "nvd_keyword_search", "keyword": keyword, "totalResults": len(results), "results": results[:max_results]}
        kw = keyword.lower()
        matched = [v for k, v in OFFLINE_CVE_DB.items() if kw in k.lower() or kw in v["description"].lower()]
        if matched:
            return {"ok": True, "source": "verified_cache", "keyword": keyword, "totalResults": len(matched), "results": matched[:max_results]}
        return {"ok": False, "keyword": keyword, "error": f"No CVEs found matching '{keyword}'"}
    
    return {"ok": False, "error": "Provide either --cve-id or --keyword"}

def main():
    if len(sys.argv) == 2 and sys.argv[1].startswith("{") and sys.argv[1].endswith("}"):
        try:
            payload = json.loads(sys.argv[1])
            res = lookup_cve(cve_id=payload.get("cve_id"), keyword=payload.get("keyword"), max_results=int(payload.get("max_results", 5)), min_score=float(payload.get("min_score", 0.0)))
            print(json.dumps(res, indent=2))
            sys.exit(0 if res.get("ok") else 1)
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e)}))
            sys.exit(1)

    parser = argparse.ArgumentParser(description="AIUI CVE Database Lookup Tool")
    parser.add_argument("--cve-id", help="Exact CVE ID")
    parser.add_argument("--keyword", help="Search keyword")
    parser.add_argument("--max-results", type=int, default=5, help="Max results")
    parser.add_argument("--min-score", type=float, default=0.0, help="Min CVSS score")
    args = parser.parse_args()

    res = lookup_cve(cve_id=args.cve_id, keyword=args.keyword, max_results=args.max_results, min_score=args.min_score)
    print(json.dumps(res, indent=2))
    sys.exit(0 if res.get("ok") else 1)

if __name__ == "__main__":
    main()
