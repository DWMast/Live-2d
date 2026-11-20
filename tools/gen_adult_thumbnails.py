#!/usr/bin/env python3
"""Create lightweight local icons for the generated adult-game catalogs."""

import hashlib
import io
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

import requests
from PIL import Image

from gen_adult_catalogs import RAW_ROOT, ROOT, deduplicate_konfox_icons

GAMES = tuple(sys.argv[1:]) or ("konfox", "sacredsword", "princessharem", "imokone")
UPSTREAM_BASES = tuple(
    base
    for base in (
        os.environ.get("LOCAL_ASSET_BASE"),
        "https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model@master/",
        RAW_ROOT,
    )
    if base
)


def download_icon(task):
    game, source_path, first_id = task
    relative = Path("public/icons") / game / f"{first_id}.webp"
    destination = ROOT / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    cache = ROOT / "tmp/research/icon-sources" / (hashlib.sha256(source_path.encode()).hexdigest() + ".png")
    cache.parent.mkdir(parents=True, exist_ok=True)
    try:
        if not destination.exists():
            if cache.exists():
                body = cache.read_bytes()
            else:
                error = None
                for base in UPSTREAM_BASES:
                    try:
                        response = requests.get(
                            base + quote(source_path),
                            headers={"User-Agent": "Live2D-viewer-thumbnail-generator"},
                            timeout=180,
                        )
                        response.raise_for_status()
                        body = response.content
                        break
                    except Exception as fetch_error:
                        error = fetch_error
                else:
                    raise error
                cache.write_bytes(body)
            image = Image.open(io.BytesIO(body)).convert("RGBA")
            bbox = image.getchannel("A").getbbox()
            if not bbox:
                raise RuntimeError(f"Texture has no visible pixels: {source_path}")
            image = image.crop(bbox)
            image.thumbnail((240, 240), Image.Resampling.LANCZOS)
            canvas = Image.new("RGBA", (256, 256), (15, 23, 42, 0))
            canvas.paste(image, ((256 - image.width) // 2, (256 - image.height) // 2), image)
            canvas.save(destination, "WEBP", quality=82, method=6)
        return game, source_path, "/" + relative.relative_to(Path("public")).as_posix(), None
    except Exception as error:
        return game, source_path, None, str(error)


def main():
    catalogs = {}
    tasks = []
    for game in GAMES:
        path = ROOT / f"public/data/{game}_catalog.json"
        entries = json.loads(path.read_text(encoding="utf-8"))
        if game == "konfox":
            entries = deduplicate_konfox_icons(entries)
        catalogs[game] = entries
        seen = {}
        for entry in entries:
            seen.setdefault(entry["iconPath"], entry["id"])
        tasks.extend((game, source_path, first_id) for source_path, first_id in seen.items())

    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(download_icon, tasks):
            results.append(result)
            print(result, flush=True)

    failures = [result for result in results if result[3]]
    if failures:
        raise RuntimeError(f"Failed to generate {len(failures)} icons: {failures}")
    icons = {(game, source_path): url for game, source_path, url, _ in results}
    for game, entries in catalogs.items():
        for entry in entries:
            entry["iconUrl"] = icons[(game, entry["iconPath"])]
        output = ROOT / f"public/data/{game}_catalog.json"
        output.write_text(json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"{game}: {len(entries)} entries, {len(set(e['iconUrl'] for e in entries))} local icons")


if __name__ == "__main__":
    main()
