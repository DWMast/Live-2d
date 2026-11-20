#!/usr/bin/env python3
"""Generate the Girl Wars JP Spine catalog from the verified viewer asset tree."""

import json
import os
import re
from collections import Counter
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/data/girlwars_catalog.json"
REPO = "Hisyn/GW-L2D-Viewer"
BRANCH = "main"


def get(url):
    headers = {"User-Agent": "Live2D-viewer-catalog-generator"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]
    response = requests.get(url, headers=headers, timeout=120)
    response.raise_for_status()
    return response


def raw(path):
    return get(f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/{path}")


def load_character_manifest():
    source = raw("src/utils/character_list.ts").text
    special = re.search(r"/\*special skins\?(.*?)\*/", source, flags=re.S)
    special_entries = {}
    if special:
        special_source = re.sub(r",\s*$", "", special.group(1).strip())
        special_entries = json.loads("{" + special_source + "}")
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    source = re.sub(r"(?m)^\s*//.*$", "", source)
    source = source.split("export default", 1)[1].strip().rstrip(";").strip()
    source = re.sub(r",\s*([}\]])", r"\1", source)
    manifest = json.JSONDecoder().raw_decode(source)[0]
    manifest.update(special_entries)
    return manifest


def main():
    manifest = load_character_manifest()
    tree_data = get(f"https://api.github.com/repos/{REPO}/git/trees/{BRANCH}?recursive=1").json()
    if tree_data.get("truncated"):
        raise RuntimeError("Truncated Girl Wars tree")
    files = {item["path"] for item in tree_data["tree"] if item.get("type") == "blob"}

    entries = []
    skipped = Counter()

    def add_model(character_id, metadata, stem, is_cutscene):
        directory = f"src/assets/spines/{character_id}"
        if is_cutscene:
            directory += "/cutscene"
        base = f"{directory}/{stem}"
        skeleton = base + ".skel"
        atlas = base + ".atlas"
        texture = base + ".png"
        if skeleton not in files or atlas not in files or texture not in files:
            skipped["incomplete_cutscene" if is_cutscene else "incomplete_standing"] += 1
            return

        portrait = f"src/assets/char_icons/herowall_{character_id}.png"
        icon = portrait if portrait in files else texture
        entries.append({
            "id": f"gw_{character_id}_cutscene" if is_cutscene else f"gw_{character_id}",
            "charName": metadata["charName"],
            "costumeName": metadata["costumeName"] + (" · Cutscene" if is_cutscene else ""),
            "modelType": "cutscene" if is_cutscene else "skin",
            "jsonPath": skeleton,
            "atlasPath": atlas,
            "iconPath": icon,
            "spineVersion": "4.0",
            "kind": "cutscene" if is_cutscene else "standing",
            "named": True,
        })

    for character_id, metadata in manifest.items():
        if not metadata.get("charName") or not metadata.get("spine"):
            skipped["invalid_manifest_entry"] += 1
            continue
        add_model(character_id, metadata, metadata["spine"], False)
        if metadata.get("cutscene"):
            add_model(character_id, metadata, metadata["cutscene"], True)

    entries.sort(key=lambda item: (item["charName"].casefold(), item["id"]))
    OUT.write_text(json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {len(entries)} verified models to {OUT.relative_to(ROOT)}")
    print("Kinds:", dict(Counter(item["kind"] for item in entries)))
    print("Portrait-backed entries:", sum("/char_icons/" in item["iconPath"] for item in entries))
    print("Named entries:", sum(bool(item["charName"]) for item in entries))
    print("Skipped:", dict(skipped))


if __name__ == "__main__":
    main()
