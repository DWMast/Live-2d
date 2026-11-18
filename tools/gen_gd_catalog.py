#!/usr/bin/env python3
"""Generate girls-symphony (Dragon & Girls Symphony / Idle Huntress) Cubism catalog."""
import json, sys, re

CHANGE_LABEL = {
    'swimsuit': 'Swimsuit', 'ur': 'UR', 'valentine': 'Valentine', 'ssr': 'SSR',
}

def main(ids_file, dirs_file, out_file):
    ids = sorted(set(json.load(open(ids_file))))
    dirs = set(json.load(open(dirs_file)))
    entries = []
    for mid in ids:
        if mid not in dirs:
            continue
        if '_' in mid:
            char, variant = mid.split('_', 1)
        else:
            char, variant = mid, ''
        label = CHANGE_LABEL.get(variant, f'Costume {variant}' if variant else 'Base')
        entries.append({
            "id": f"gs_{mid}",
            "charName": char.upper() if len(char) <= 3 else char.capitalize(),
            "costumeName": f"{char.capitalize()} · {label}",
            "modelType": "skin",
            "jsonPath": f"assets/{mid}/live2d.model3.json",
            "iconPath": f"{char}.png",
            "api": "cubism4",
        })
    json.dump(entries, open(out_file, 'w'), indent=1, ensure_ascii=False)
    print(f"wrote {len(entries)} entries to {out_file}")

main(*sys.argv[1:4])
