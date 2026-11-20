#!/usr/bin/env python3
"""Build the Destiny Child Cubism 2 catalog from verified public source trees."""

import json
import os
import requests
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/data/destinychild_catalog.json"
DCG = "Live2D-DCG/Live2D-DCG.github.io"
PELOM = "Pelom777/DestinyChildLive2D"
ARCHIVE = "PhasmaExMachina/destiny-child-mods-archive"


def get_json(url):
    headers = {"User-Agent": "Live2D-viewer-catalog-generator"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]
    response = requests.get(url, headers=headers, timeout=120)
    response.raise_for_status()
    return response.json()


def raw(repo, branch, path):
    return get_json(f"https://raw.githubusercontent.com/{repo}/{branch}/{path}")


def tree(repo, branch):
    data = get_json(f"https://api.github.com/repos/{repo}/git/trees/{branch}?recursive=1")
    if data.get("truncated"):
        raise RuntimeError(f"Truncated tree for {repo}")
    return {item["path"] for item in data["tree"] if item.get("type") == "blob"}


def main():
    dcg_files = tree(DCG, "master")
    pelom_files = tree(PELOM, "master")
    models = raw(DCG, "master", "data/models.json")
    names = raw(DCG, "master", "data/names.json")
    uncensor = raw(ARCHIVE, "master", "src/lists/uncensor.json")["mods"]

    entries = []
    skipped = Counter()
    for model_id, model_name, outfit, category, regions in models:
        base_id, _, variant = model_id.partition("_")
        metadata = names.get(base_id, {})
        char_name = model_name or metadata.get("name", "")
        variant_meta = metadata.get("variants", {}).get(variant, {})
        costume_name = outfit or variant_meta.get("title", "")
        if not costume_name:
            costume_name = "Default" if variant in ("00", "01", "") else f"{category.title()} {variant}"
        if not char_name.strip() or char_name.strip().lower() in {"unknown", "???", "??", "none", "null"}:
            skipped["unnamed"] += 1
            continue

        region = "Korean" if "k" in regions else "Global"
        model_dir = f"static/{region}/{model_id}"
        json_path = f"{model_dir}/MOC.{model_id}.json"
        if json_path not in dcg_files or f"{model_dir}/character.dat" not in dcg_files:
            skipped["incomplete_model"] += 1
            continue

        portrait = f"assets/live2d/{model_id}/icon.png"
        if portrait in pelom_files:
            icon_path = portrait
        else:
            textures = sorted(
                path for path in dcg_files
                if path.startswith(model_dir + "/") and path.lower().endswith(".png")
            )
            icon_path = next((path for path in textures if path.endswith("/texture_00.png")), "")
            if not icon_path and textures:
                icon_path = textures[0]
            if not icon_path:
                skipped["missing_icon"] += 1

        entries.append({
            "id": f"dc_{model_id}",
            "charName": char_name,
            "costumeName": costume_name,
            "modelType": category,
            "jsonPath": json_path,
            "iconPath": icon_path,
            "api": "cubism2",
            "region": "kr" if region == "Korean" else "gl",
            "uncensored": model_id in uncensor and region == "Korean",
            "kind": category,
            "named": True,
        })

    entries.sort(key=lambda item: (item["charName"].casefold(), item["id"]))
    OUT.write_text(json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {len(entries)} verified named models to {OUT.relative_to(ROOT)}")
    print("Categories:", dict(Counter(item["modelType"] for item in entries)))
    print("Regions:", dict(Counter(item["region"] for item in entries)))
    print("Portrait icons:", sum(item["iconPath"].startswith("assets/") for item in entries))
    print("Texture preview icons:", sum(item["iconPath"].startswith("static/") for item in entries))
    print("Explicit original uncensor restorations:", sum(item["uncensored"] for item in entries))
    print("Skipped:", dict(skipped))


if __name__ == "__main__":
    main()
