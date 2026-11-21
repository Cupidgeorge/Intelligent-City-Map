#!/usr/bin/env python3
"""Replace straight station-to-station chords with OpenStreetMap track geometry.

The MTR open-data file only gives station order. The curves come from
OpenStreetMap route relations, the same map data OpenFreeMap draws.
"""

from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NETWORK_PATH = ROOT / "public" / "data" / "network.json"
CACHE_PATH = ROOT / "scripts" / "osm-mtr-routes.json"

# One full-route relation per direction we draw. East Rail needs both the
# Lo Wu and Lok Ma Chau branches. Tseung Kwan O needs the LOHAS Park branch.
RELATIONS = {
    "ISL": [4432665],
    "TWL": [9736530],
    "KTL": [272125],
    "TKL": [269672, 9736610],
    "EAL": [4248592, 4248591],
    "TML": [6102298],
    "TCL": [5317704],
    "AEL": [5317238],
    "SIL": [6827211],
    "DRL": [4709540],
}


def fetch_relations() -> dict:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    id_list = ",".join(str(item) for ids in RELATIONS.values() for item in ids)
    query = f"[out:json][timeout:180];relation(id:{id_list});out geom;"
    request = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=urllib.parse.urlencode({"data": query}).encode(),
        headers={"User-Agent": "hk-smart-map/0.1 (classroom map)"},
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = json.load(response)
    CACHE_PATH.write_text(json.dumps(payload), encoding="utf-8")
    return payload


def meters(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat = math.radians((a[1] + b[1]) / 2)
    dx = math.radians(a[0] - b[0]) * math.cos(lat) * 6_371_000
    dy = math.radians(a[1] - b[1]) * 6_371_000
    return math.hypot(dx, dy)


def length(coords: list[tuple[float, float]]) -> float:
    return sum(meters(coords[index], coords[index + 1]) for index in range(len(coords) - 1))


def stitch(relation: dict, gap: float = 80) -> list[list[tuple[float, float]]]:
    segments: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    for member in relation.get("members", []):
        if member.get("type") != "way" or not member.get("geometry"):
            continue
        coords = [(point["lon"], point["lat"]) for point in member["geometry"]]
        if len(coords) < 2:
            continue
        if not current:
            current = coords
            continue
        forward = meters(current[-1], coords[0])
        backward = meters(current[-1], coords[-1])
        if forward <= backward:
            chosen, distance = coords, forward
        else:
            chosen, distance = list(reversed(coords)), backward
        if distance <= gap:
            current.extend(chosen[1:])
        else:
            segments.append(current)
            current = list(chosen)
    if current:
        segments.append(current)
    return segments


def join_segments(
    segments: list[list[tuple[float, float]]],
    limit: float = 1200,
) -> list[list[tuple[float, float]]]:
    kept = [segment for segment in segments if length(segment) >= 1000]
    changed = True
    while changed and len(kept) > 1:
        changed = False
        best: tuple[float, int, int, str] | None = None
        for left in range(len(kept)):
            for right in range(left + 1, len(kept)):
                pairs = {
                    "end-start": meters(kept[left][-1], kept[right][0]),
                    "end-end": meters(kept[left][-1], kept[right][-1]),
                    "start-start": meters(kept[left][0], kept[right][0]),
                    "start-end": meters(kept[left][0], kept[right][-1]),
                }
                kind = min(pairs, key=pairs.get)
                distance = pairs[kind]
                if best is None or distance < best[0]:
                    best = (distance, left, right, kind)
        if best is None or best[0] > limit:
            break
        _, left, right, kind = best
        first = kept[left]
        second = kept[right]
        if kind == "end-end":
            second = list(reversed(second))
        elif kind == "start-start":
            first = list(reversed(first))
        elif kind == "start-end":
            first, second = second, first
        merged = first + second[1:]
        kept = [segment for index, segment in enumerate(kept) if index not in {left, right}]
        kept.append(merged)
        changed = True
    return kept


def simplify(coords: list[tuple[float, float]], spacing: float = 18) -> list[list[float]]:
    if not coords:
        return []
    kept = [coords[0]]
    for point in coords[1:-1]:
        if meters(kept[-1], point) >= spacing:
            kept.append(point)
    if coords[-1] != kept[-1]:
        kept.append(coords[-1])
    return [[round(lon, 5), round(lat, 5)] for lon, lat in kept]


def main() -> None:
    payload = fetch_relations()
    by_id = {item["id"]: item for item in payload["elements"]}
    network = json.loads(NETWORK_PATH.read_text(encoding="utf-8"))
    network["trackSource"] = "https://www.openstreetmap.org route relations via Overpass"
    for line in network["lines"]:
        tracks = []
        for relation_id in RELATIONS[line["code"]]:
            segments = join_segments(stitch(by_id[relation_id]))
            tracks.extend(simplify(segment) for segment in segments if len(segment) >= 2)
        if not tracks:
            raise RuntimeError(f"no track geometry for {line['code']}")
        line["tracks"] = tracks
        line["offset"] = 0
        print(line["code"], [len(track) for track in tracks])
    NETWORK_PATH.write_text(json.dumps(network, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("wrote", NETWORK_PATH)


if __name__ == "__main__":
    main()
