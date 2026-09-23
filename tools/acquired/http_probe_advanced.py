#!/usr/bin/env python3
import sys
import json
import time
import argparse
import urllib.request
import urllib.parse
import ssl

def probe(url, method="GET", follow_redirects=True):
    t0 = time.time()
    parsed = urllib.parse.urlparse(url)
    if not parsed.scheme or parsed.scheme not in ["http", "https"]:
        return {"ok": False, "error": "Invalid URL scheme. Must be http or https."}

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    handlers = [urllib.request.HTTPSHandler(context=ctx)]
    if not follow_redirects:
        handlers.append(NoRedirect())
    opener = urllib.request.build_opener(*handlers)

    req = urllib.request.Request(url, method=method, headers={"User-Agent": "AIUI-Advanced-Probe/1.0"})
    
    try:
        with opener.open(req, timeout=10) as resp:
            latency_ms = round((time.time() - t0) * 1000, 2)
            headers = dict(resp.headers)
            body = resp.read(4096).decode('utf-8', errors='replace')
            return {
                "ok": True,
                "url": url,
                "statusCode": resp.status,
                "latencyMs": latency_ms,
                "headers": headers,
                "bodySnippet": body,
                "bodyLength": len(body),
            }
    except urllib.error.HTTPError as e:
        latency_ms = round((time.time() - t0) * 1000, 2)
        body = e.read(2048).decode('utf-8', errors='replace') if e.fp else ""
        return {
            "ok": True,
            "url": url,
            "statusCode": e.code,
            "latencyMs": latency_ms,
            "headers": dict(e.headers),
            "bodySnippet": body,
            "error": str(e),
        }
    except Exception as e:
        return {"ok": False, "url": url, "error": str(e)}

def main():
    parser = argparse.ArgumentParser(description="Advanced HTTP/TLS Prober")
    parser.add_argument("--url", required=True, help="Target URL")
    parser.add_argument("--method", default="GET", help="HTTP Method")
    parser.add_argument("--follow-redirects", action="store_true", default=True, help="Follow redirects")
    args = parser.parse_args()

    res = probe(args.url, args.method, args.follow_redirects)
    print(json.dumps(res, indent=2))
    sys.exit(0 if res.get("ok") else 1)

if __name__ == "__main__":
    main()
