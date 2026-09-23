#!/usr/bin/env python3
"""
AIUI Red-Team Intelligence SQLite FTS5 Indexer
Indexes vulnerability data, operational frameworks, and tool references
into an ultra-fast, zero-memory SQLite FTS5 database at data/redteam/redteam.sqlite3.
"""

import os
import sys
import json
import sqlite3
import argparse
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = ROOT_DIR / "data" / "redteam"
DB_PATH = DATA_DIR / "redteam.sqlite3"

SAMPLE_VULNERABILITIES = [
    {
        "cve_id": "CVE-2024-3094",
        "title": "XZ Utils Backdoor (liblzma)",
        "cvss": 10.0,
        "severity": "CRITICAL",
        "description": "Malicious code was discovered in the upstream tarballs of xz, starting with version 5.6.0. Through a series of complex M4 macros and test files, an injected backdoor intercepts RSA_public_decrypt in sshd.",
        "affected": "xz-utils 5.6.0, 5.6.1; OpenSSH systemd integration",
        "cwe": "CWE-506: Embedded Malicious Code",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2024-3094"]
    },
    {
        "cve_id": "CVE-2021-44228",
        "title": "Log4Shell (Apache Log4j2 JNDI RCE)",
        "cvss": 10.0,
        "severity": "CRITICAL",
        "description": "Apache Log4j2 2.0-beta9 through 2.15.0 JNDI features used in configuration, log messages, and parameters do not protect against attacker controlled LDAP and other JNDI related endpoints.",
        "affected": "Apache Log4j 2.0-beta9 to 2.14.1",
        "cwe": "CWE-917: Improper Neutralization of Special Elements used in an Expression Language Statement",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2021-44228"]
    },
    {
        "cve_id": "CVE-2024-6387",
        "title": "regreSSHion: Remote Unauthenticated Code Execution in OpenSSH",
        "cvss": 8.1,
        "severity": "HIGH",
        "description": "A signal handler race condition in OpenSSH's server (sshd) allows unauthenticated remote code execution as root on glibc-based 32-bit and 64-bit Linux systems.",
        "affected": "OpenSSH 8.5p1 through 9.7p1",
        "cwe": "CWE-362: Concurrent Execution using Shared Resource with Improper Synchronization",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2024-6387"]
    },
    {
        "cve_id": "CVE-2023-38606",
        "title": "Operation Triangulation iOS Kernel Vulnerability",
        "cvss": 7.8,
        "severity": "HIGH",
        "description": "An app may be able to modify sensitive kernel state. Apple addressed this issue with improved state management for page table manipulations.",
        "affected": "iOS < 16.6, iPadOS < 16.6, macOS Ventura < 13.5",
        "cwe": "CWE-119: Memory Corruption",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-38606"]
    }
]

SAMPLE_FRAMEWORKS = [
    {
        "domain": "web_application",
        "methodology": "OWASP Top 10 (2025/2026)",
        "phase": "reconnaissance_and_input_validation",
        "roe_guidelines": "Always verify explicit written authorization and scope boundaries before dispatching probes. Never run destructive injections on live production environments.",
        "decision_tree": json.dumps({
            "step_1": "Passive reconnaissance and technology stack fingerprinting",
            "step_2": "Endpoint enumeration and schema discovery",
            "step_3": "Authentication and session management audit",
            "step_4": "Input validation and parameterized query verification"
        })
    },
    {
        "domain": "smart_contracts",
        "methodology": "SWC Registry & PTES",
        "phase": "static_analysis_and_reentrancy_checks",
        "roe_guidelines": "Audit logic locally or on private forked testnets (Anvil/Hardhat). Never interact with mainnet contracts with unauthorized intents.",
        "decision_tree": json.dumps({
            "check_1": "Checks-Effects-Interactions pattern validation",
            "check_2": "ReentrancyGuard modifier presence on state changes",
            "check_3": "Integer overflow/underflow checks and SafeMath",
            "check_4": "Access control on privileged initializers"
        })
    }
]

SAMPLE_TOOLS = [
    {
        "tool_name": "nmap",
        "category": "reconnaissance",
        "description": "Network exploration tool and security / port scanner.",
        "syntax": "nmap -sV -sC -p <ports> <target>"
    },
    {
        "tool_name": "subfinder",
        "category": "osint",
        "description": "Fast passive subdomain enumeration tool.",
        "syntax": "subfinder -d <domain> -silent"
    },
    {
        "tool_name": "wazuh",
        "category": "siem",
        "description": "Open source security monitoring and threat detection platform.",
        "syntax": "wazuh-control status / tail -f /var/ossec/logs/alerts/alerts.json"
    }
]


def init_database(db_path: Path) -> sqlite3.Connection:
    """Initialize schema and FTS5 tables in SQLite."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")

    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS vulnerabilities (
            cve_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            cvss REAL,
            severity TEXT,
            description TEXT,
            affected TEXT,
            cwe TEXT,
            references_json TEXT
        );
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS operational_frameworks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            domain TEXT NOT NULL,
            methodology TEXT,
            phase TEXT,
            roe_guidelines TEXT,
            decision_tree TEXT
        );
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tools_reference (
            tool_name TEXT PRIMARY KEY,
            category TEXT,
            description TEXT,
            syntax TEXT
        );
    """)

    cursor.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_security USING fts5(
            record_id UNINDEXED,
            category,
            title,
            content,
            tokenize='porter unicode61'
        );
    """)

    conn.commit()
    return conn


def populate_records(conn: sqlite3.Connection, seed_sample: bool = True, source_file: str = None):
    """Insert structured records and index into FTS5."""
    cursor = conn.cursor()

    if seed_sample:
        for v in SAMPLE_VULNERABILITIES:
            cursor.execute("""
                INSERT OR REPLACE INTO vulnerabilities 
                (cve_id, title, cvss, severity, description, affected, cwe, references_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                v["cve_id"], v["title"], v["cvss"], v["severity"],
                v["description"], v["affected"], v["cwe"], json.dumps(v.get("references", []))
            ))
            cursor.execute("""
                INSERT OR REPLACE INTO fts_security (record_id, category, title, content)
                VALUES (?, 'vulnerability', ?, ?)
            """, (v["cve_id"], f"{v['cve_id']} - {v['title']}", f"{v['description']} {v['affected']} {v['cwe']}"))

        for f in SAMPLE_FRAMEWORKS:
            cursor.execute("""
                INSERT INTO operational_frameworks (domain, methodology, phase, roe_guidelines, decision_tree)
                VALUES (?, ?, ?, ?, ?)
            """, (f["domain"], f["methodology"], f["phase"], f["roe_guidelines"], f["decision_tree"]))
            cursor.execute("""
                INSERT INTO fts_security (record_id, category, title, content)
                VALUES (?, 'framework', ?, ?)
            """, (f"{f['domain']}_{f['phase']}", f"{f['domain']} - {f['methodology']}", f"{f['roe_guidelines']} {f['decision_tree']}"))

        for t in SAMPLE_TOOLS:
            cursor.execute("""
                INSERT OR REPLACE INTO tools_reference (tool_name, category, description, syntax)
                VALUES (?, ?, ?, ?)
            """, (t["tool_name"], t["category"], t["description"], t["syntax"]))
            cursor.execute("""
                INSERT INTO fts_security (record_id, category, title, content)
                VALUES (?, 'tool', ?, ?)
            """, (t["tool_name"], t["tool_name"], f"{t['category']} {t['description']} {t['syntax']}"))

    if source_file and Path(source_file).exists():
        p = Path(source_file)
        print(f"Loading external dataset from {p}...")
        with open(p, "r", encoding="utf-8") as f:
            if p.suffix == ".jsonl":
                for idx, line in enumerate(f):
                    line = line.strip()
                    if not line:
                        continue
                    item = json.loads(line)
                    title = item.get("title") or item.get("prompt") or f"Record {idx}"
                    content = item.get("content") or item.get("response") or json.dumps(item)
                    cursor.execute("""
                        INSERT INTO fts_security (record_id, category, title, content)
                        VALUES (?, 'training_sample', ?, ?)
                    """, (f"sample_{idx}", str(title)[:100], str(content)[:2000]))
            elif p.suffix == ".json":
                data = json.load(f)
                if isinstance(data, list):
                    for idx, item in enumerate(data):
                        title = item.get("title") or item.get("name") or f"Record {idx}"
                        cursor.execute("""
                            INSERT INTO fts_security (record_id, category, title, content)
                            VALUES (?, 'custom_json', ?, ?)
                        """, (f"json_{idx}", str(title)[:100], json.dumps(item)[:2000]))

    conn.commit()


def main():
    parser = argparse.ArgumentParser(description="Index Red-Team Intelligence into SQLite FTS5")
    parser.add_argument("--db", type=str, default=str(DB_PATH), help="Target SQLite database path")
    parser.add_argument("--source", type=str, help="Path to JSON or JSONL file to index")
    parser.add_argument("--query", type=str, help="Execute an FTS5 search query")
    parser.add_argument("--stats", action="store_true", help="Print database statistics")
    args = parser.parse_args()

    db_path = Path(args.db)
    conn = init_database(db_path)

    if args.query:
        cursor = conn.cursor()
        print(f"Searching for: '{args.query}'...")
        cursor.execute("""
            SELECT category, title, snippet(fts_security, 3, '[', ']', '...', 12)
            FROM fts_security
            WHERE fts_security MATCH ?
            ORDER BY rank
            LIMIT 5;
        """, (args.query,))
        rows = cursor.fetchall()
        print(f"Found {len(rows)} matching results:")
        for r in rows:
            print(f"\n[{r[0].upper()}] {r[1]}")
            print(f"  {r[2]}")
        return

    populate_records(conn, seed_sample=True, source_file=args.source)
    print(f"Database initialized and indexed at {db_path} ({db_path.stat().st_size:,} bytes).")

    cursor = conn.cursor()
    cursor.execute("SELECT count(*) FROM vulnerabilities")
    vuln_count = cursor.fetchone()[0]
    cursor.execute("SELECT count(*) FROM operational_frameworks")
    fw_count = cursor.fetchone()[0]
    cursor.execute("SELECT count(*) FROM tools_reference")
    tool_count = cursor.fetchone()[0]
    cursor.execute("SELECT count(*) FROM fts_security")
    fts_count = cursor.fetchone()[0]

    print("\n--- Current Index Summary ---")
    print(f"Vulnerabilities:       {vuln_count}")
    print(f"Frameworks & ROE:      {fw_count}")
    print(f"Tools Reference:       {tool_count}")
    print(f"Total FTS5 Documents:  {fts_count}")


if __name__ == "__main__":
    main()
