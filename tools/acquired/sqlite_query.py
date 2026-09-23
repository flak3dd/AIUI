#!/usr/bin/env python3
import sys
import json
import sqlite3
import argparse
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="AIUI SQLite Query Tool")
    parser.add_argument("--db-path", required=True, help="Path to SQLite database")
    parser.add_argument("--query", required=True, help="SQL statement")
    parser.add_argument("--read-only", action="store_true", help="Disallow mutating statements")
    args = parser.parse_args()

    db_path = args.db_path
    if db_path != ":memory:":
        p = Path(db_path).resolve()
        if not p.exists() and ("SELECT" in args.query.upper() or "PRAGMA" in args.query.upper()):
            print(json.dumps({"ok": False, "error": f"Database file not found: {db_path}"}))
            sys.exit(1)
        db_target = str(p)
    else:
        db_target = ":memory:"

    if args.read_only:
        upper = args.query.strip().upper()
        for forbidden in ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE"]:
            if upper.startswith(forbidden):
                print(json.dumps({"ok": False, "error": f"Mutating command {forbidden} rejected in read-only mode"}))
                sys.exit(1)

    try:
        conn = sqlite3.connect(db_target)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Handle multiple semicolon-delimited statements
        stmts = [s.strip() for s in args.query.split(";") if s.strip()]
        last_rows = []
        tables_modified = 0

        for stmt in stmts:
            cursor.execute(stmt)
            if cursor.description:
                rows = cursor.fetchall()
                last_rows = [dict(r) for r in rows]
            else:
                tables_modified += cursor.rowcount

        conn.commit()
        conn.close()

        print(json.dumps({
            "ok": True,
            "rowCount": len(last_rows),
            "rows": last_rows[:500],
            "rowsAffected": tables_modified,
            "truncated": len(last_rows) > 500,
            "dbPath": db_target
        }, indent=2))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
