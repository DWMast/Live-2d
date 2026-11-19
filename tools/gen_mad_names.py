#!/usr/bin/env python3
"""Regenerate public/data/mad_catalog.json names + icons from anyabot's master
data (MAD-Viewer). Re-runs are idempotent; asset paths/skeleton routes untouched."""
import json, urllib.request

def fetch(url):
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.read()
    except Exception:
        # Sandboxes without a system CA bundle: fall back to curl.
        import subprocess
        return subprocess.check_output(['curl', '-sL', url])

RAW = 'https://raw.githubusercontent.com/anyabot/MAD-Viewer/main'
skin_list = json.loads(fetch(f'{RAW}/public/data/skin_list.json'))
if isinstance(skin_list, dict):
    skin_list = skin_list['skins']
chars = json.loads(fetch(f'{RAW}/public/data/characters.json'))['characters']
icons = json.loads(fetch(f'{RAW}/public/data/icons.json'))['groups']

PATH = 'public/data/mad_catalog.json'
catalog = json.load(open(PATH, encoding='utf-8'))
skmap = {s['key']: s for s in skin_list}

from collections import Counter
cnt = Counter()
for e in catalog:
    cnt[(skmap[e['id']]['character'], skmap[e['id']]['kind'])] += 1
seen = Counter()
KIND = {'affection': 'Affection', 'standing': 'Standing', 'desire': 'Desire',
        'pleasure': 'Pleasure', 'drama': 'Drama'}

for e in catalog:
    s = skmap[e['id']]
    ce = chars.get(s['character']) or {}
    name = ce.get('nameEn') or ce.get('name') or s['character']
    n = cnt[(s['character'], s['kind'])]
    seen[(s['character'], s['kind'])] += 1
    label = KIND.get(s['kind'], 'Skin')
    e['charName'] = name
    e['nameCn'] = ce.get('name') or ''
    e['costumeName'] = f'{name} · {label} {seen[(s["character"], s["kind"])]}' if n > 1 else f'{name} · {label}'
    key = s['key'].upper()
    if f'Thumbnail_{key}' in icons['skin']:
        e['iconPath'] = f'skin/Thumbnail_{key}.webp'
    elif f'Icon_{s["character"]}' in icons['char']:
        e['iconPath'] = f'char/Icon_{s["character"]}.webp'
    else:
        e['iconPath'] = ''
    e['uncensored'] = '__google' in (e.get('jsonPath') or '')

json.dump(catalog, open(PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'renamed {len(catalog)} entries; icons {sum(1 for e in catalog if e["iconPath"])}; uncensored {sum(1 for e in catalog if e["uncensored"])}')
