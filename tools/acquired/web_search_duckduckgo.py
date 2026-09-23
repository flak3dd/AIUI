#!/usr/bin/env python3
import sys
import json
import re
import urllib.request
import urllib.parse
import argparse

def search_ddg(query, max_results=5):
    encoded = urllib.parse.quote_plus(query)
    url = f"https://html.duckduckgo.com/html/?q={encoded}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)"
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            html = res.read().decode('utf-8', errors='ignore')
    except Exception as e:
        return {"ok": False, "error": f"Search network request failed: {e}"}

    # Extract snippets, titles, and links
    results = []
    blocks = re.findall(r'<div class="result__body">.*?</div>\s*</div>', html, re.DOTALL)
    if not blocks:
        blocks = re.findall(r'<div class="links_main.*?">.*?</div>', html, re.DOTALL)

    for b in blocks[:max_results]:
        title_m = re.search(r'<a[^>]+class="result__a"[^>]*>(.*?)</a>', b, re.DOTALL)
        snippet_m = re.search(r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>', b, re.DOTALL)
        url_m = re.search(r'href="(.*?)"', b)

        title = re.sub(r'<[^>]+>', '', title_m.group(1)).strip() if title_m else ""
        snippet = re.sub(r'<[^>]+>', '', snippet_m.group(1)).strip() if snippet_m else ""
        raw_url = url_m.group(1) if url_m else ""

        # Unpack DDG redirect
        target_url = raw_url
        if 'uddg=' in raw_url:
            parsed = urllib.parse.parse_qs(urllib.parse.urlparse(raw_url).query)
            if 'uddg' in parsed:
                target_url = parsed['uddg'][0]

        if title or snippet:
            results.append({
                "title": title,
                "snippet": snippet,
                "url": target_url
            })

    return {
        "ok": True,
        "query": query,
        "count": len(results),
        "results": results
    }

def main():
    parser = argparse.ArgumentParser(description="AIUI DuckDuckGo Web Search")
    parser.add_argument("--query", required=True, help="Search query")
    parser.add_argument("--max-results", type=int, default=5, help="Max results")
    args = parser.parse_args()

    res = search_ddg(args.query, args.max_results)
    print(json.dumps(res, indent=2))
    sys.exit(0 if res.get("ok") else 1)

if __name__ == "__main__":
    main()
