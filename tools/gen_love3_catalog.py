#!/usr/bin/env python3
"""Generate the LOVE³ -LOVE CUBE- Cubism catalog from verified model manifests."""

import json
import os
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path, PurePosixPath
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/data/love3_catalog.json"
REPO = "Eikanya/Live2d-model"
GAME_ROOT = "galgame live2d/LOVE³-LOVE CUBE-"
RAW_ROOT = f"https://raw.githubusercontent.com/{REPO}/master/"
API_ROOT = f"https://api.github.com/repos/{REPO}/git/trees/"
CHARACTERS = {
    "akira": ("Akira Higashibojo", "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/939600/extras/ae19d3149a91f756ee46248ec93c3f46.avif?t=1663813689"),
    "iori": ("Iori Shitaka", "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/939600/extras/cea14a3736a3e8ebb12e1d8ad1ac7f8f.avif?t=1663813689"),
    "nodoka": ("Nodoka Amabane", "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/939600/extras/6993f5330cad378b05598de496c1042b.avif?t=1663813689"),
    "kuroneko": ("Kuroneko", ""),
}


def get(url):
    headers = {"User-Agent": "Live2D-viewer-catalog-generator"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]
    response = requests.get(url, headers=headers, timeout=120)
    response.raise_for_status()
    return response


def tree(ref, recursive=False):
    suffix = "?recursive=1" if recursive else ""
    return get(API_ROOT + ref + suffix).json()["tree"]


def game_files():
    galgame = next(item for item in tree("master") if item["path"] == "galgame live2d")
    game = next(item for item in tree(galgame["sha"]) if item["path"] == "LOVE³-LOVE CUBE-")
    return {item["path"] for item in tree(game["sha"], True) if item["type"] == "blob"}


def costume_name(stem, character, adult):
    if character == "kuroneko":
        return "Adult" if adult else "Default"
    code = stem[len(character) + 1:].upper() if stem.startswith(character + "_") else stem.upper()
    if adult:
        return (code[:-2] if code.endswith("_N") else code) + " · Adult"
    return code


def main():
    files = game_files()
    model_paths = sorted(path for path in files if path.endswith(".model3.json"))

    def build(model_path):
        full_path = f"{GAME_ROOT}/{model_path}"
        settings = get(RAW_ROOT + quote(full_path)).json()
        references = settings["FileReferences"]
        required = [references["Moc"], *references["Textures"]]
        for motion_group in references.get("Motions", {}).values():
            required.extend(motion["File"] for motion in motion_group)
        parent = str(PurePosixPath(model_path).parent)
        for reference in required:
            resolved = str(PurePosixPath(parent, reference))
            if resolved not in files:
                raise RuntimeError(f"Missing referenced file: {GAME_ROOT}/{resolved}")

        parts = model_path.split("/")
        adult = parts[0] == "adult"
        character = parts[-2]
        char_name, official_icon = CHARACTERS[character]
        stem = PurePosixPath(model_path).name[:-len(".model3.json")]
        first_texture = str(PurePosixPath(parent, references["Textures"][0]))
        return {
            "id": "love3_" + stem,
            "charName": char_name,
            "costumeName": costume_name(stem, character, adult),
            "modelType": "adult" if adult else "skin",
            "jsonPath": full_path,
            "iconPath": f"{GAME_ROOT}/{first_texture}" if not official_icon else "",
            "iconUrl": official_icon,
            "api": "cubism4",
            "uncensored": adult,
            "kind": "adult" if adult else "regular",
            "named": True,
        }

    with ThreadPoolExecutor(max_workers=8) as pool:
        entries = list(pool.map(build, model_paths))
    entries.sort(key=lambda item: (item["charName"], item["kind"], item["id"]))
    OUT.write_text(json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {len(entries)} complete models to {OUT.relative_to(ROOT)}")
    print("Kinds:", dict(Counter(item["kind"] for item in entries)))
    print("Characters:", dict(Counter(item["charName"] for item in entries)))
    print("Official portraits:", sum(bool(item["iconUrl"]) for item in entries))


if __name__ == "__main__":
    main()
