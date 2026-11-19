#!/usr/bin/env python3
"""Pick the correct store build for every MAD skin based on real spine censorship data.

The 'google == uncensored' assumption is NOT universally true. Each build's
spine.json carries a censorship block listing _UNCEN (nude) and _CEN (overlay)
attachments. This script:
  1.Fetches both upstream trees (anyabot/MAD-assets-1, MAD-assets-2, master).
  2.For every catalog entry, finds the real folder for each available store.
  3.Fetches spine.json for each store build and reads its censorship block.
  4.Chooses the nude build when one exists, else the non-censored build, and
    rewrites jsonPath/atlasPath (case-correct) + the uncensored flag.
Idempotent: re-running re-derives everything from upstream.
"""
import json
import os
import subprocess
import sys
import tempfile
import concurrent.futures as cf

REPOS = ("MAD-assets-1", "MAD-assets-2")
BRANCH = "master"
BASE = "/workspace/bold-ramanujan"
CATALOG = os.path.join(BASE, "public/data/mad_catalog.json")
RAW = "https://raw.githubusercontent.com/anyabot/{repo}/{branch}/{path}"


def fetch(url):
    r = subprocess.run(["curl", "-s", "--max-time", "60", url], capture_output=True)
    return r.stdout


def get_tree(repo):
    cache = os.path.join(tempfile.gettempdir(), f"{repo}-tree.json")
    if os.path.exists(cache):
        return json.load(open(cache))
    r = subprocess.run(
        ["curl", "-s", "--max-time", "120",
         f"https://api.github.com/repos/anyabot/{repo}/git/trees/{BRANCH}?recursive=1"],
        capture_output=True)
    t = json.loads(r.stdout)
    json.dump(t, open(cache, "w"))
    return t


def main():
    trees = {}
    for repo in REPOS:
        trees[repo] = get_tree(repo)

    def find_folder(prefix):
        """Locate skins/<prefix> folder (exact or case-insensitive) in any repo."""
        want = f"skins/{prefix}".lower()
        for repo, t in trees.items():
            for item in t.get("tree", []):
                p = item["path"]
                if p.lower() == want:
                    return repo, p
        for repo, t in trees.items():
            for item in t.get("tree", []):
                p = item["path"]
                if p.lower().startswith(want + "/"):
                    return repo, p
        return None, None

    def folder_files(repo, path, ext):
        return [i["path"] for i in trees[repo].get("tree", [])
                if i["path"].startswith(path + "/") and i["path"].lower().endswith(ext)]

    def spine_censorship(repo, path):
        cand = [p for p in folder_files(repo, path, ".json")
                if p.lower().endswith("/spine.json")]
        if not cand:
            return None
        d = fetch(RAW.format(repo=repo, branch=BRANCH, path=cand[0]))
        try:
            return json.loads(d).get("censorship")
        except Exception:
            return None

    catalog = json.load(open(CATALOG))
    entries = catalog if isinstance(catalog, list) else list(catalog.values())
    tasks = [(e, ["google", "onestore"]) for e in entries]

    results = {}

    def work(args):
        e, _ = args
        eid = e["id"]
        stores = e.get("stores") or []
        if not stores:
            tail = e.get("jsonPath", "")
            if "__google" in tail: stores = ["google"]
            elif "__onestore" in tail: stores = ["onestore"]
        loc = {}
        censors = {}
        for s in stores:
            prefix = f"{eid}__{s}"
            repo, path = find_folder(prefix)
            if not path:
                continue
            loc[s] = (repo, path)
            censors[s] = spine_censorship(repo, path)
        return eid, stores, loc, censors

    with cf.ThreadPoolExecutor(8) as ex:
        for eid, stores, loc, censors in ex.map(work, tasks):
            results[eid] = (stores, loc, censors)

    changed = 0
    summary = {"nude_switch": [], "relabelled": [], "censored_only": [], "no_censor_data": []}
    for e in entries:
        eid = e["id"]
        stores, loc, censors = results[eid]
        if not loc:
            continue
        def nude(s): return bool(censors[s] and censors[s].get("uncensored"))
        def cen(s): return bool(censors[s] and censors[s].get("censored"))
        nude_stores = [s for s in stores if s in loc and nude(s)]
        clean_stores = [s for s in stores if s in loc and s not in nude_stores and not cen(s)]
        if nude_stores:
            chosen = nude_stores[0]
        elif clean_stores:
            chosen = clean_stores[0]
        elif stores:
            chosen = stores[0]
            summary["censored_only"].append(f"{eid} ({chosen})")
            continue
        else:
            continue
        repo, path = loc[chosen]
        skel = folder_files(repo, path, ".skel")
        atlas = folder_files(repo, path, ".atlas")
        if not skel or not atlas:
            summary["no_censor_data"].append(f"{eid}: missing skel/atlas in {repo}/{path}")
            continue
        jp = f"{path}/{os.path.basename(skel[0])}"
        ap = f"{path}/{os.path.basename(atlas[0])}"
        is_nude = chosen in nude_stores
        if e.get("uncensored") != is_nude or e.get("jsonPath") != jp:
            changed += 1
            if is_nude and not e.get("uncensored"):
                summary["relabelled"].append(eid)
            elif jp != e.get("jsonPath"):
                summary["nude_switch"].append(f"{eid}->{chosen}")
        e["uncensored"] = is_nude
        e["jsonPath"] = jp
        e["atlasPath"] = ap
        spec = censors[chosen] or {}
        e["censorBuild"] = {
            "store": chosen,
            "nude": is_nude,
            "hasCensorOverlay": bool(spec.get("censored")),
            "allBuildsCensored": len(nude_stores) == 0 and any(s in loc and cen(s) for s in stores),
        }
    json.dump(entries, open(CATALOG, "w"), ensure_ascii=False, indent=1)
    print("changed entries:", changed)
    print("nude store switched:", summary["nude_switch"])
    print("newly flagged uncensored:", summary["relabelled"])
    print("censored-only:", summary["censored_only"])


if __name__ == "__main__":
    main()
