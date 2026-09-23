#!/usr/bin/env python3
"""
AIUI Dataset Loader: WNT3D/Ultimate-Offensive-Red-Team
Provides utilities to stream, download, and inspect components of the
Hugging Face 'WNT3D/Ultimate-Offensive-Red-Team' dataset.
"""

import os
import sys
import json
import argparse
from pathlib import Path

REPO_ID = "WNT3D/Ultimate-Offensive-Red-Team"
LOCAL_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "redteam"

AVAILABLE_FILES = [
    "README.md",
    "dataset_info.json",
    "operational_framework.json",
    "vulnerability_database.json",
    "tools_exploits_reference.json",
    "attack_playbooks.json",
    "target_analysis_strategies.json",
    "smart_contract_vulns.json",
    "crypto_defi_exploits.json",
    "rust_security.json",
    "training_sample.jsonl",
    "training_data.jsonl",
    "ultimate_red_team_complete.json",
    "comprehensive_training.jsonl",
    "massive_training.jsonl",
    "millions_training.jsonl",
    "millions_final.jsonl",
    "training_data.parquet",
]


def download_file_fallback(filename: str, dest_dir: Path) -> Path:
    """Download a file from Hugging Face using urllib if huggingface_hub is not installed."""
    import urllib.request

    url = f"https://huggingface.co/datasets/{REPO_ID}/resolve/main/{filename}"
    dest_path = dest_dir / filename
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Downloading {filename} from {url}...")
    headers = {"User-Agent": "AIUI-RedTeam-Loader/1.0"}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp, open(dest_path, "wb") as f:
        while True:
            chunk = resp.read(64 * 1024)
            if not chunk:
                break
            f.write(chunk)

    print(f"Saved to {dest_path} ({dest_path.stat().st_size:,} bytes)")
    return dest_path


def get_dataset_file(filename: str, target_dir: Path = LOCAL_DATA_DIR) -> Path:
    """Fetch a specific file using huggingface_hub or fallback to urllib."""
    target_path = target_dir / filename
    if target_path.exists():
        return target_path

    try:
        from huggingface_hub import hf_hub_download
        print(f"Downloading {filename} via huggingface_hub...")
        downloaded = hf_hub_download(
            repo_id=REPO_ID,
            repo_type="dataset",
            filename=filename,
            local_dir=str(target_dir),
        )
        return Path(downloaded)
    except ImportError:
        return download_file_fallback(filename, target_dir)


def load_component_data(filename: str, target_dir: Path = LOCAL_DATA_DIR):
    """Download and load either JSON or JSONL content into memory."""
    filepath = get_dataset_file(filename, target_dir)
    print(f"Loading {filepath.name}...")
    if filepath.suffix == ".jsonl":
        records = []
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    records.append(json.loads(line))
        return records
    elif filepath.suffix == ".json":
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    else:
        with open(filepath, "r", encoding="utf-8") as f:
            return f.read()


def load_via_hf_datasets(streaming: bool = True):
    """Load dataset using Hugging Face datasets library."""
    try:
        from datasets import load_dataset
        print(f"Loading dataset '{REPO_ID}' (streaming={streaming})...")
        ds = load_dataset(REPO_ID, streaming=streaming)
        return ds
    except ImportError:
        print("Error: 'datasets' library is not installed. Install via: pip install datasets")
        return None


def main():
    parser = argparse.ArgumentParser(description="Load WNT3D/Ultimate-Offensive-Red-Team dataset")
    parser.add_argument("--file", choices=AVAILABLE_FILES, help="Download and inspect a specific file")
    parser.add_argument("--list-files", action="store_true", help="List all available files in the dataset")
    parser.add_argument("--stream", action="store_true", help="Demonstrate streaming via 'datasets' library")
    parser.add_argument("--sample", type=int, default=3, help="Number of records to display")
    args = parser.parse_args()

    if args.list_files:
        print("\nAvailable files in dataset:")
        for idx, f in enumerate(AVAILABLE_FILES, 1):
            print(f"  {idx:2d}. {f}")
        return

    if args.stream:
        ds = load_via_hf_datasets(streaming=True)
        if ds is not None:
            train_split = ds["train"]
            print(f"\nStreaming first {args.sample} examples from 'train' split:")
            for idx, item in enumerate(train_split):
                if idx >= args.sample:
                    break
                print(f"\n--- Example {idx + 1} ---")
                print(json.dumps(item, indent=2)[:500] + "...")
        return

    selected_file = args.file or "operational_framework.json"
    data = load_component_data(selected_file)
    print(f"\nSuccessfully loaded {selected_file}!")
    if isinstance(data, list):
        print(f"Total entries: {len(data):,}")
        print(f"First {min(args.sample, len(data))} entries preview:")
        for idx, item in enumerate(data[:args.sample]):
            print(f"\n--- Item {idx + 1} ---")
            print(json.dumps(item, indent=2)[:500] + "...")
    elif isinstance(data, dict):
        print(f"Top-level keys: {list(data.keys())}")
        preview_key = list(data.keys())[0] if data else None
        if preview_key:
            print(f"\nPreview of '{preview_key}':")
            print(json.dumps(data[preview_key], indent=2)[:500] + "...")


if __name__ == "__main__":
    main()
