#!/usr/bin/env python3
"""Generate verified adult-game Live2D catalogs from Eikanya's public asset archive."""

import json
import os
import posixpath
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path, PurePosixPath
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parents[1]
REPO = "Eikanya/Live2d-model"
RAW_ROOT = f"https://raw.githubusercontent.com/{REPO}/master/"
API_ROOT = f"https://api.github.com/repos/{REPO}/git/trees/"
KONFOX_ROOT = "galgame live2d/[めがみそふと] 【Live2D】コン狐との日常+(ぷらす)"
PRINCESS_ROOT = "galgame live2d/[200502][らぷらす] プリンセスハーレム [RJ280657]"
SACRED_SWORD_ROOT = "Sacred Sword princesses"
IMOKONE_ROOT = "イモコネー届けたい恋心/assets/live2dmodels"

SESSION = requests.Session()
SESSION.headers["User-Agent"] = "Live2D-viewer-catalog-generator"
if os.environ.get("GITHUB_TOKEN"):
    SESSION.headers["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]


def get(url):
    response = SESSION.get(url, timeout=120)
    response.raise_for_status()
    return response


def tree(ref, recursive=False):
    suffix = "?recursive=1" if recursive else ""
    return get(API_ROOT + ref + suffix).json()["tree"]


def game_files(game_root):
    if os.environ.get("EIKANYA_TREE_CACHE"):
        cached = json.loads((ROOT / "tmp/research/eikanya_tree.json").read_text(encoding="utf-8"))
        prefix = game_root + "/"
        return {
            item["path"][len(prefix):]
            for item in cached["tree"]
            if item["type"] == "blob" and item["path"].startswith(prefix)
        }
    node = None
    for segment in game_root.split("/"):
        if node is None:
            items = tree("master")
        else:
            items = tree(node["sha"])
        node = next(item for item in items if item["path"] == segment and item["type"] == "tree")
    return {item["path"] for item in tree(node["sha"], True) if item["type"] == "blob"}


def referenced_files(settings):
    references = settings.get("FileReferences")
    if references:
        required = [references["Moc"], *references.get("Textures", [])]
        for group in references.get("Motions", {}).values():
            required.extend(item["File"] for item in group)
        required.extend(item["File"] for item in references.get("Expressions", []))
        for key in ("Physics", "Pose"):
            value = references.get(key)
            if isinstance(value, dict) and value.get("File"):
                required.append(value["File"])
        return required, references["Textures"][0]

    required = [settings["model"], *settings.get("textures", [])]
    for group in settings.get("motions", {}).values():
        required.extend(item["file"] for item in group)
    required.extend(item["file"] for item in settings.get("expressions", []))
    required.extend(settings[key] for key in ("physics", "pose") if settings.get(key))
    return required, settings["textures"][0]


def load_complete_manifest(game_root, files, model_path):
    full_path = f"{game_root}/{model_path}"
    settings = get(RAW_ROOT + quote(full_path)).json()
    required, first_texture = referenced_files(settings)
    parent = str(PurePosixPath(model_path).parent)
    missing = []
    required = [reference for reference in required if reference]
    for reference in required:
        resolved = posixpath.normpath(str(PurePosixPath(parent, reference)))
        if resolved.startswith("../"):
            missing.append(resolved)
        elif resolved not in files:
            # A recursive repository-wide response can be truncated. In explicit
            # cache mode, confirm omitted files against raw.githubusercontent.
            if os.environ.get("EIKANYA_TREE_CACHE"):
                remote = RAW_ROOT + quote(f"{game_root}/{resolved}")
                if SESSION.head(remote, timeout=60).status_code == 200:
                    continue
            missing.append(resolved)
    if missing:
        raise RuntimeError(f"Missing references for {full_path}: {missing}")
    return settings, str(PurePosixPath(parent, first_texture))


def slug(value):
    return re.sub(r"_+", "_", re.sub(r"[^a-zA-Z0-9]+", "_", value)).strip("_").lower()


OUTFITS = {
    "adult": "Adult Outfit",
    "ane": "Older Sister Outfit",
    "apron": "Apron",
    "blo": "Bloomers",
    "cami": "Camisole",
    "casual": "Casual Outfit",
    "cheer": "Cheerleader",
    "china": "China Dress",
    "ck": "CK Outfit",
    "ero": "Erotic Outfit",
    "fuu": "Fuu Outfit",
    "goth": "Gothic Lolita",
    "himo": "String Bikini",
    "idol": "Idol",
    "mabi": "Mabi Outfit",
    "maid": "Maid",
    "micro": "Micro Bikini",
    "miko": "Shrine Maiden",
    "mizugi": "Swimsuit",
    "mizugi2": "Swimsuit II",
    "mk": "MK Outfit",
    "nadeneko": "Cat Costume",
    "nana": "Nana Outfit",
    "neru": "Sleepwear",
    "none": "No Outfit",
    "nurse": "Nurse",
    "ony": "Ony Outfit",
    "sakyu": "Succubus",
    "seihuku": "School Uniform",
    "sima": "Striped Bikini",
    "simicro": "Striped Micro Bikini",
    "simple": "Simple Outfit",
    "sitagi": "Lingerie",
    "sk": "SK Outfit",
    "slave": "Slave Outfit",
    "suit": "Suit",
    "suku": "School Swimsuit",
    "taisou": "Gym Uniform",
    "towel": "Towel",
    "yukata": "Yukata",
    "yuki": "Winter Outfit",
    "konko": "Fox Girl Outfit",
}
MODES = {
    "itizen": "Idle",
    "stand": "Standing",
    "kiss": "Kiss",
    "nade": "Head Pat",
    "mainmenu": "Main Menu",
    "tea": "Tea Time",
}
NANAKO_MODES = {"nanako": "Standing", "nanako_daki": "Hugging Pillow", "nanako_nade": "Head Pat"}
OPENING_SCENES = {"konko": "Fox Girl", "nadenade": "Head Pat", "tea": "Tea Time"}
ADULT_SCENES = {
    "back": "Rear Entry",
    "closer": "Cowgirl · Close",
    "far": "Cowgirl · Full View",
    "fella": "Fellatio",
    "fella_2": "Fellatio II",
    "kiss": "Adult Kiss",
    "pai": "Paizuri",
    "sei": "Missionary",
    "tekoki": "Handjob",
}
DATES = {
    "eigakan": "Movie Theater",
    "kanransha_night": "Ferris Wheel · Night",
    "kanransha_noon": "Ferris Wheel · Day",
    "kouen_evening": "Park · Evening",
    "kouen_night": "Park · Night",
    "kouen_noon": "Park · Day",
}


def konfox_entry(files, model_path):
    settings, _ = load_complete_manifest(KONFOX_ROOT, files, model_path)
    parent = str(PurePosixPath(model_path).parent)
    icon = posixpath.normpath(str(PurePosixPath(parent, settings["textures"][-1])))
    parts = model_path.split("/")
    mode = parts[0]
    char_name = "Nanako" if mode in NANAKO_MODES else "Ito" if mode == "ito" else "Konko"
    adult = mode == "h"
    if mode in MODES:
        outfit = parts[1]
        costume = f"{OUTFITS.get(outfit, outfit.upper() + ' Outfit')} · {MODES[mode]}"
        kind = "skin" if mode in ("itizen", "stand") else "interaction"
    elif mode in NANAKO_MODES:
        outfit = parts[1]
        costume = f"{OUTFITS.get(outfit, outfit.upper() + ' Outfit')} · {NANAKO_MODES[mode]}"
        kind = "skin" if mode == "nanako" else "interaction"
    elif mode == "op":
        costume = f"{OPENING_SCENES.get(parts[1], parts[1].title())} · Opening"
        kind = "cutscene"
    elif adult:
        costume = f"{ADULT_SCENES.get(parts[1], parts[1].replace('_', ' ').title())} · Adult"
        kind = "adult"
    elif mode == "date":
        costume = f"{DATES.get(parts[1], parts[1].replace('_', ' ').title())} · Date"
        kind = "date"
    elif mode == "bath":
        costume = "Bath"
        kind = "interaction"
    elif mode == "ito":
        costume = "Standing"
        kind = "skin"
    else:
        raise RuntimeError(f"Unnamed Konfox mode: {model_path}")
    return {
        "id": "konfox_" + slug(model_path.replace(".model.json", "")),
        "charName": char_name,
        "costumeName": costume,
        "modelType": "adult" if adult else "skin",
        "jsonPath": f"{KONFOX_ROOT}/{model_path}",
        "iconPath": f"{KONFOX_ROOT}/{icon}",
        "api": "cubism2",
        "kind": kind,
        "named": True,
    }


SACRED_SWORD_MODELS = {
    "boss_cg_live2d_002/res/.model.json": ("Carose", "Character Scene", False),
    "boss_cg_live2d_004/res/.model.json": ("Iderhela", "Character Scene", False),
    "boss_cg_live2d_h004/.model.json": ("Iderhela", "Adult Scene", True),
    "char2d_live2d_001/res/sardyamodel.model.json": ("Sardiya", "Standing", False),
    "char_cg_live2d_004/res/.model.json": ("Betty", "Character Scene", False),
    "char_cg_live2d_005/res/.model.json": ("Emily", "Character Scene", False),
    "char_cg_live2d_007/.model.json": ("Dorla", "Character Scene", False),
    "char_cg_live2d_049/.model.json": ("Airmanir", "Character Scene", False),
    "char_cg_live2d_h015/res/.model.json": ("Claire", "Adult Scene", True),
    "char_cg_live2d_h016/res/.model.json": ("Chris", "Adult Scene", True),
    "char_cg_live2d_h021/res/.model.json": ("Yell", "Adult Scene", True),
    "char_cg_live2d_h048/.model.json": ("Ainir", "Adult Scene", True),
}


def sacred_sword_entry(files, model_path):
    _, icon = load_complete_manifest(SACRED_SWORD_ROOT, files, model_path)
    char_name, costume, adult = SACRED_SWORD_MODELS[model_path]
    folder = model_path.split("/")[0]
    return {
        "id": "ssp_" + folder,
        "charName": char_name,
        "costumeName": costume,
        "modelType": "adult" if adult else "skin",
        "jsonPath": f"{SACRED_SWORD_ROOT}/{model_path}",
        "iconPath": f"{SACRED_SWORD_ROOT}/{icon}",
        "api": "cubism2",
        "kind": "adult" if adult else "skin",
        "named": True,
    }


PRINCESS_MODELS = {
    "アズール/アズール おさわり第一画面1 69正常位.model.json": ("princessharem_azur_touch", "Azur", "Touching · Intimate Scene"),
    "アズール/アズール 後背位第一画面12.model3.json": ("princessharem_azur_rear_1", "Azur", "Rear Entry · Scene I"),
    "アズール/アズール 後背位第二画面39.model3.json": ("princessharem_azur_rear_2", "Azur", "Rear Entry · Scene II"),
    "フローラ/フローラ1_100.model3.json": ("princessharem_flora_1", "Flora", "Adult Scene I"),
    "フローラ/フローラ2_20.model3.json": ("princessharem_flora_2", "Flora", "Adult Scene II"),
}

# Reuse verified scene previews instead of fetching two redundant large atlas pages.
PRINCESS_ICON_OVERRIDES = {
    "アズール/アズール おさわり第一画面1 69正常位.model.json": "アズール/textures/texture_00 #3.png",
    "フローラ/フローラ1_100.model3.json": "フローラ/textures/texture_00.png",
}


def princess_entry(files, model_path):
    _, icon = load_complete_manifest(PRINCESS_ROOT, files, model_path)
    icon = PRINCESS_ICON_OVERRIDES.get(model_path, icon)
    entry_id, char_name, costume = PRINCESS_MODELS[model_path]
    return {
        "id": entry_id,
        "charName": char_name,
        "costumeName": costume,
        "modelType": "adult",
        "jsonPath": f"{PRINCESS_ROOT}/{model_path}",
        "iconPath": f"{PRINCESS_ROOT}/{icon}",
        "api": "cubism4",
        "kind": "adult",
        "named": True,
    }


IMOKONE_MODELS = {
    "my_fj_dadun/my_fj_dadun.model3.json": ("Hagiwara Michiru (萩原満月)", "Bedroom Dozing", False),
    "my_fj_youxi/my_fj_youxi.model3.json": ("Hagiwara Michiru (萩原満月)", "Bedroom Play", False),
    "my_kt_xuegao/my_kt_xuegao.model3.json": ("Hagiwara Michiru (萩原満月)", "Living Room Ice Cream", False),
    "my_shuaya/my_shuaya.model3.json": ("Hagiwara Michiru (萩原満月)", "Brushing Teeth", False),
    "my_shuaya_mai/my_shuaya_mai.model3.json": ("Hagiwara Michiru (萩原満月)", "Brushing Teeth · Alternate", False),
    "my_yushi/my_yushi.model3.json": ("Hagiwara Michiru (萩原満月)", "Bathroom", False),
    "sry_chufang/sry_chufang.model3.json": ("Enomoto Mikaru (榎本三日月)", "Kitchen", False),
    "sry_fj_qipao/sry_fj_qipao.model3.json": ("Enomoto Mikaru (榎本三日月)", "Bedroom Qipao", False),
    "sry_fj_youxi/sry_fj_youxi.model3.json": ("Enomoto Mikaru (榎本三日月)", "Bedroom Play", False),
    "sry_kt_shafa/sry_kt_shafa.model3.json": ("Enomoto Mikaru (榎本三日月)", "Living Room Sofa", False),
    "sry_kt_yizi/sry_kt_yizi.model3.json": ("Enomoto Mikaru (榎本三日月)", "Living Room Chair", False),
    "sry_yushi/sry_yushi.model3.json": ("Enomoto Mikaru (榎本三日月)", "Bathroom", False),
    "cg/my_back1/my_back1.model3.json": ("Hagiwara Michiru (萩原満月)", "Back CG · Adult", True),
    "cg/sry_chuye/sry_chuye.model3.json": ("Enomoto Mikaru (榎本三日月)", "First Night CG · Adult", True),
    "interactiveh/my_h1/my_h1.model3.json": ("Hagiwara Michiru (萩原満月)", "Interactive H 1", True),
    "interactiveh/sry_h1/sry_h1.model3.json": ("Enomoto Mikaru (榎本三日月)", "Interactive H 1", True),
    "a_001/a_001.model3.json": ("Sisters Connect", "Touch Scene A", True),
    "b_101/b_101.model3.json": ("Sisters Connect", "Side/Back Touch Scene B", True),
}

IMOKONE_ICON_OVERRIDES = {
    "my_kt_xuegao/my_kt_xuegao.model3.json": "my_fj_dadun/textures/texture_00.png",
    "a_001/a_001.model3.json": "interactiveh/my_h1/textures/texture_00.png",
    "b_101/b_101.model3.json": "interactiveh/sry_h1/textures/texture_00.png",
}


def imokone_entry(files, model_path):
    _, icon = load_complete_manifest(IMOKONE_ROOT, files, model_path)
    icon = IMOKONE_ICON_OVERRIDES.get(model_path, icon)
    char_name, costume, _ = IMOKONE_MODELS[model_path]
    # The source is R18 RJ01189784, including its interactive touch scenes.
    adult = True
    return {
        "id": "imokone_" + slug(model_path.split("/")[-1].replace(".model3.json", "")),
        "charName": char_name,
        "costumeName": costume,
        "modelType": "adult" if adult else "skin",
        "jsonPath": f"{IMOKONE_ROOT}/{model_path}",
        "iconPath": f"{IMOKONE_ROOT}/{icon}",
        "api": "cubism4",
        "kind": "adult" if adult else "skin",
        "named": True,
    }


def deduplicate_konfox_icons(entries):
    stand = {
        item["jsonPath"].split("/stand/", 1)[1].split("/", 1)[0]: item["iconPath"]
        for item in entries
        if "/stand/" in item["jsonPath"]
    }
    nanako = {
        item["jsonPath"].split("/nanako/", 1)[1].split("/", 1)[0]: item["iconPath"]
        for item in entries
        if "/nanako/" in item["jsonPath"]
    }
    for item in entries:
        path = item["jsonPath"]
        if any(f"/{mode}/" in path for mode in ("itizen", "kiss", "nade", "mainmenu", "tea")):
            outfit = path.rsplit("/", 2)[1]
            if outfit in stand:
                item["iconPath"] = stand[outfit]
        elif "/nanako_daki/" in path or "/nanako_nade/" in path:
            outfit = path.rsplit("/", 2)[1]
            if outfit in nanako:
                item["iconPath"] = nanako[outfit]
    return entries


def generate(name, game_root, selector, builder, allow_skip=False):
    files = game_files(game_root)
    candidates = sorted(path for path in files if selector(path))
    entries = []
    failures = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [(path, pool.submit(builder, files, path)) for path in candidates]
        for path, future in futures:
            try:
                entries.append(future.result())
            except Exception as error:
                failures.append((path, str(error)))
    if failures and not allow_skip:
        details = "\n".join(f"{path}: {error}" for path, error in failures)
        raise RuntimeError(f"Refusing to write incomplete {name} catalog:\n{details}")
    if not entries:
        raise RuntimeError(f"No complete entries found for {name}")
    if failures:
        print(f"{name}: skipped {len(failures)} incomplete manifests")
        for path, error in failures:
            print(f"  {path}: {error}")
    if name == "konfox":
        entries = deduplicate_konfox_icons(entries)
    entries.sort(key=lambda item: (item["charName"], item["kind"] != "skin", item["costumeName"], item["id"]))
    ids = [item["id"] for item in entries]
    if len(ids) != len(set(ids)):
        raise RuntimeError(f"Duplicate {name} catalog ids")
    output = ROOT / f"public/data/{name}_catalog.json"
    output.write_text(json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{name}: {len(entries)} complete named models; kinds={dict(Counter(item['kind'] for item in entries))}")


def main():
    generate(
        "konfox",
        KONFOX_ROOT,
        lambda path: path.endswith(".model.json"),
        konfox_entry,
        allow_skip=True,
    )
    generate(
        "sacredsword",
        SACRED_SWORD_ROOT,
        lambda path: path in SACRED_SWORD_MODELS,
        sacred_sword_entry,
    )
    generate(
        "princessharem",
        PRINCESS_ROOT,
        lambda path: path in PRINCESS_MODELS,
        princess_entry,
    )
    generate(
        "imokone",
        IMOKONE_ROOT,
        lambda path: path in IMOKONE_MODELS,
        imokone_entry,
    )


if __name__ == "__main__":
    main()
