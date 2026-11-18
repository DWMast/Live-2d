#!/usr/bin/env python3
"""Generate anchorpanic catalog from SpineCollections AnchorPanic file list."""
import json, re, sys
from collections import defaultdict

def main(list_file, out_file):
    files = [l.strip() for l in open(list_file) if l.strip().endswith(('.skel', '.atlas'))]
    dirs = defaultdict(lambda: {'skel': None, 'atlas': None})
    for f in files:
        m = re.match(r'AnchorPanic/(spine|spine_2)/([^/]+)/(.+)$', f)
        if not m:
            continue
        _, d, name = m.groups()
        key = f"{d}"
        if name.endswith('.skel'):
            dirs[key]['skel'] = name
        elif name.endswith('.atlas') and not name.endswith('.prefab'):
            dirs[key]['atlas'] = name

    entries = []
    for d in sorted(dirs, key=lambda x: (x.split('_')[0], x)):
        info = dirs[d]
        if not info['skel'] or not info['atlas']:
            print(f"skip {d}: missing pair", file=sys.stderr)
            continue
        base = re.sub(r'_p?(\d+)$', '', d) or d
        # baseId as 4-digit hero id when possible
        m = re.match(r'^(\d+)', d)
        baseId = m.group(1) if m else d
        variant = d[len(baseId):].lstrip('_') if d.startswith(baseId) else ''
        suffix_label = 'Base' if not variant else f'Costume {variant}'
        entries.append({
            "id": f"ap_{d}",
            "charName": f"Hero {baseId}",
            "costumeName": f"Anchor #{baseId} · {suffix_label}",
            "modelType": "skin",
            "jsonPath": f"AnchorPanic/spine/{d}/{info['skel']}",
            "baseId": baseId,
            "costumeIndex": 0 if not variant else int(re.sub(r'\D', '', variant) or 0),
            "atlasPath": f"AnchorPanic/spine/{d}/{info['atlas']}",
            "spineVersion": "3.8",
            "kind": "character",
        })
    json.dump(entries, open(out_file, 'w'), indent=1, ensure_ascii=False)
    print(f"wrote {len(entries)} entries to {out_file}")

if __name__ == '__main__':
    main(*sys.argv[1:3])
