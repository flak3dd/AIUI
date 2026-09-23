#!/usr/bin/env python3
"""
================================================================================
AIUI CLUSTER TELEMETRY & MULTI-HOST DIAGNOSTIC COLLECTOR
================================================================================
Probes services across both loopback and LAN IP interfaces:
  - Mac Host (192.168.4.50): Web UI (:5173), MemPalace (:17333), Key Proxy (:17332), Self-Awareness (:17336)
  - DGX Spark (100.66.147.53): Sandbox Runner (:17330), containers, workspaces
  - Qwen vLLM Endpoint (192.168.4.103): vLLM Inference (:8000)

Writes consolidated JSON data to a file to prevent long base64 SSH command buffer overflows.
================================================================================
"""
import sys
import os
import json
import argparse
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

DEFAULT_MAC_HOST = os.environ.get("MAC_HOST", "192.168.4.50")
DEFAULT_SPARK_HOST = os.environ.get("SPARK_HOST", "100.66.147.53")
DEFAULT_QWEN_HOST = os.environ.get("SPARK_QWEN_HOST", "192.168.4.103")
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REPORT = REPO_ROOT / "data" / "reports" / "telemetry_report.json"

def build_service_matrix(mac_host, spark_host, qwen_host=DEFAULT_QWEN_HOST):
    return [
        {
            "id": "vllm_health",
            "name": "vLLM Inference (:8000)",
            "primary_host": "dgx_spark",
            "endpoints": [
                f"http://127.0.0.1:8000/health",
                f"http://{qwen_host}:8000/health",
            ],
        },
        {
            "id": "vllm_models",
            "name": "vLLM Models List (:8000)",
            "primary_host": "dgx_spark",
            "endpoints": [
                f"http://127.0.0.1:8000/v1/models",
                f"http://{qwen_host}:8000/v1/models",
            ],
        },
        {
            "id": "sandbox_runner",
            "name": "Sandbox Runner (:17330)",
            "primary_host": "dgx_spark",
            "endpoints": [
                f"http://127.0.0.1:17330/health",
                f"http://{spark_host}:17330/health",
                f"http://{mac_host}:17330/health",
            ],
        },
        {
            "id": "sandbox_health",
            "name": "Sandbox Env Health (:17330)",
            "primary_host": "dgx_spark",
            "endpoints": [
                f"http://127.0.0.1:17330/api/sandbox/health",
                f"http://{spark_host}:17330/api/sandbox/health",
            ],
        },
        {
            "id": "mempalace_bridge",
            "name": "MemPalace Context Bridge (:17333)",
            "primary_host": "mac_host",
            "endpoints": [
                f"http://127.0.0.1:17333/health",
                f"http://{mac_host}:17333/health",
            ],
        },
        {
            "id": "mempalace_status",
            "name": "MemPalace Vector Memory (:17333)",
            "primary_host": "mac_host",
            "endpoints": [
                f"http://127.0.0.1:17333/mcp/status",
                f"http://{mac_host}:17333/mcp/status",
            ],
        },
        {
            "id": "agent_monitor",
            "name": "Agent Telemetry Monitor (:17335)",
            "primary_host": "shared",
            "endpoints": [
                f"http://127.0.0.1:17335/health",
                f"http://{spark_host}:17335/health",
                f"http://{mac_host}:17335/health",
            ],
        },
        {
            "id": "self_awareness_health",
            "name": "Self-Awareness Daemon (:17336)",
            "primary_host": "mac_host",
            "endpoints": [
                f"http://127.0.0.1:17336/health",
                f"http://{mac_host}:17336/health",
            ],
        },
        {
            "id": "self_awareness_suggestions",
            "name": "Meta-Awareness Suggestions (:17336)",
            "primary_host": "mac_host",
            "endpoints": [
                f"http://127.0.0.1:17336/api/suggestions",
                f"http://{mac_host}:17336/api/suggestions",
            ],
        },
        {
            "id": "chat_optimizer",
            "name": "Chat Response Optimizer (:17337)",
            "primary_host": "shared",
            "endpoints": [
                f"http://127.0.0.1:17337/api/policy",
                f"http://{spark_host}:17337/api/policy",
                f"http://{mac_host}:17337/api/policy",
            ],
        },
    ]

def probe_endpoint(url, timeout=3):
    t0 = datetime.now()
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "AIUI-Telemetry-Collector/2.0",
                "Accept": "application/json, text/plain, */*",
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            latency_ms = int((datetime.now() - t0).total_seconds() * 1000)
            raw = resp.read().decode("utf-8", errors="ignore")
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = raw[:300]
            return {
                "ok": True,
                "url": url,
                "status": resp.status,
                "latency_ms": latency_ms,
                "data": parsed,
            }
    except urllib.error.HTTPError as e:
        latency_ms = int((datetime.now() - t0).total_seconds() * 1000)
        return {
            "ok": False,
            "url": url,
            "status": e.code,
            "latency_ms": latency_ms,
            "error": str(e),
        }
    except Exception as e:
        latency_ms = int((datetime.now() - t0).total_seconds() * 1000)
        return {
            "ok": False,
            "url": url,
            "status": 0,
            "latency_ms": latency_ms,
            "error": str(e),
        }

def collect_telemetry(mac_host=DEFAULT_MAC_HOST, spark_host=DEFAULT_SPARK_HOST, output_path=None, quiet=False):
    if output_path is None:
        output_path = DEFAULT_REPORT
    matrix = build_service_matrix(mac_host, spark_host)
    report = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "clusterTopology": {
            "macHost": mac_host,
            "sparkHost": spark_host,
        },
        "services": {},
        "summary": {
            "total": len(matrix),
            "online": 0,
            "offline": 0,
        },
    }

    if not quiet:
        print("\n================================================================================")
        print("📡 AIUI CLUSTER TELEMETRY & DIAGNOSTIC AUDIT")
        print("================================================================================")
        print(f"{'SERVICE & SUBSYSTEM':<36} {'STATUS':<10} {'LATENCY':<10} {'RESOLVED TARGET'}")
        print("-" * 80)

    for svc in matrix:
        name = svc["name"]
        best_res = None

        for ep in svc["endpoints"]:
            res = probe_endpoint(ep)
            if res["ok"]:
                best_res = res
                break
            if best_res is None or (res["status"] > 0 and best_res["status"] == 0):
                best_res = res

        if best_res is None:
            best_res = {"ok": False, "url": svc["endpoints"][0], "status": 0, "latency_ms": 0, "error": "Unreachable"}

        report["services"][svc["id"]] = {
            "name": name,
            "primaryHost": svc["primary_host"],
            **best_res,
        }

        if best_res["ok"]:
            report["summary"]["online"] += 1
            status_str = f"HTTP {best_res['status']}"
        elif best_res["status"] > 0:
            report["summary"]["offline"] += 1
            status_str = f"HTTP {best_res['status']}"
        else:
            report["summary"]["offline"] += 1
            status_str = "OFFLINE"

        lat_str = f"{best_res['latency_ms']}ms"

        if not quiet:
            indicator = "✔" if best_res["ok"] else "✘"
            print(f"{indicator} {name:<34} {status_str:<10} {lat_str:<10} {best_res['url']}")

    p = Path(output_path).resolve()
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    if not quiet:
        print("-" * 80)
        print(f"Summary: {report['summary']['online']} Online | {report['summary']['offline']} Offline")
        print(f"✓ Output written to: {p}\n")

    return report

def main():
    parser = argparse.ArgumentParser(description="AIUI Cluster Telemetry & Diagnostics Collector")
    parser.add_argument("--output", "-o", default=str(DEFAULT_REPORT), help="Path to write JSON report")
    parser.add_argument("--mac-host", default=DEFAULT_MAC_HOST, help="Mac Host IP (default: 192.168.4.50)")
    parser.add_argument("--spark-host", default=DEFAULT_SPARK_HOST, help="DGX Spark Host IP (default: 100.66.147.53)")
    parser.add_argument("--quiet", "-q", action="store_true", help="Suppress console stdout table")
    args = parser.parse_args()

    report = collect_telemetry(
        mac_host=args.mac_host,
        spark_host=args.spark_host,
        output_path=args.output,
        quiet=args.quiet,
    )

    # Return 0 if critical inference (vLLM or Sandbox Runner) is healthy
    vllm_ok = report["services"].get("vllm_health", {}).get("ok", False)
    runner_ok = report["services"].get("sandbox_runner", {}).get("ok", False)
    sys.exit(0 if (vllm_ok or runner_ok) else 1)

if __name__ == "__main__":
    main()
