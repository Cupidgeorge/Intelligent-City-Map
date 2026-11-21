#!/usr/bin/env python3
"""Build the station network and traffic-camera snapshot used by the map.

Station names and order come from the MTR open-data lines file.
Coordinates come from the Lands Department Location Search API (HK1980 grid)
and are converted to WGS84. The script caches those lookups so it does not
repeat a large burst of requests.
"""

from __future__ import annotations

import csv
import io
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
CACHE_PATH = ROOT / "scripts" / "geocode-cache.json"
NETWORK_PATH = ROOT / "public" / "data" / "network.json"
CAMERAS_PATH = ROOT / "public" / "data" / "cameras.json"

LINES_URL = "https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv"
CAMERAS_URL = (
    "https://static.data.gov.hk/td/traffic-snapshot-images/code/"
    "Traffic_Camera_Locations_Tc.csv"
)
SEARCH_URL = "https://www.map.gov.hk/gs/api/v1.0.0/locationSearch?q="

HK = timezone(timedelta(hours=8))
TO_WGS84 = Transformer.from_crs("EPSG:2326", "EPSG:4326", always_xy=True)

LINE_META = [
    ("ISL", "港島綫", "Island Line", "#0860a8", -3),
    ("TWL", "荃灣綫", "Tsuen Wan Line", "#ed1d24", 3),
    ("KTL", "觀塘綫", "Kwun Tong Line", "#1a9431", -2),
    ("TKL", "將軍澳綫", "Tseung Kwan O Line", "#6b208b", 2),
    ("EAL", "東鐵綫", "East Rail Line", "#5eb6e4", -4),
    ("TML", "屯馬綫", "Tuen Ma Line", "#9a3b26", 4),
    ("TCL", "東涌綫", "Tung Chung Line", "#fe7f1d", -1),
    ("AEL", "機場快綫", "Airport Express", "#1c7670", 1),
    ("SIL", "南港島綫", "South Island Line", "#b5bd00", 5),
    ("DRL", "迪士尼綫", "Disneyland Resort Line", "#f550a6", 0),
]
LINE_ORDER = {code: index for index, (code, *_) in enumerate(LINE_META)}

# The lines file uses a variant character. The map service uses 荔.
QUERY_CHAR = str.maketrans({"茘": "荔"})


def fetch(url: str, user_agent: str, timeout: int = 40) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": user_agent, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def load_lines() -> list[dict[str, str]]:
    raw = fetch(LINES_URL, "hk-smart-map/0.1").decode("utf-8-sig")
    return [row for row in csv.DictReader(io.StringIO(raw)) if row["Line Code"].strip()]


def load_cache() -> dict[str, dict[str, object]]:
    if not CACHE_PATH.exists():
        return {}
    return json.loads(CACHE_PATH.read_text(encoding="utf-8"))


def save_cache(cache: dict[str, dict[str, object]]) -> None:
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def geocode(name_zh: str, cache: dict[str, dict[str, object]]) -> dict[str, object]:
    query_name = name_zh.translate(QUERY_CHAR)
    expected = f"港鐵{query_name}站"
    if name_zh in cache and cache[name_zh].get("nameZH") == expected:
        return cache[name_zh]

    url = SEARCH_URL + urllib.parse.quote(expected)
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            payload = json.loads(
                fetch(url, "Mozilla/5.0", timeout=30).decode("utf-8")
            )
            if not payload:
                raise RuntimeError(f"no result for {expected}")
            top = payload[0]
            if top.get("nameZH") != expected:
                raise RuntimeError(f"unexpected match for {expected}: {top.get('nameZH')}")
            cache[name_zh] = {
                "x": top["x"],
                "y": top["y"],
                "nameZH": top["nameZH"],
                "nameEN": top.get("nameEN", ""),
            }
            save_cache(cache)
            time.sleep(0.2)
            return cache[name_zh]
        except Exception as error:  # noqa: BLE001 - retry transient API failures
            last_error = error
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed to geocode {expected}: {last_error}")


def choose_trunk(directions: dict[str, list[str]]) -> list[str]:
    simple = [codes for name, codes in directions.items() if name in {"UT", "DT"}]
    if not simple:
        raise RuntimeError(f"no UT/DT direction in {directions.keys()}")
    simple.sort(key=len, reverse=True)
    return simple[0]


def branch_paths(directions: dict[str, list[str]], trunk: list[str]) -> list[list[str]]:
    trunk_set = set(trunk)
    branches: list[list[str]] = []
    for codes in directions.values():
        extras = [code for code in codes if code not in trunk_set]
        if not extras:
            continue
        for extra in extras:
            index = codes.index(extra)
            if index > 0 and codes[index - 1] in trunk_set:
                segment = [codes[index - 1], extra]
            elif index + 1 < len(codes) and codes[index + 1] in trunk_set:
                segment = [extra, codes[index + 1]]
            else:
                raise RuntimeError(f"cannot attach branch station {extra} from {codes}")
            if segment not in branches and list(reversed(segment)) not in branches:
                branches.append(segment)
    return branches


def build_network(rows: list[dict[str, str]], cache: dict[str, dict[str, object]]) -> dict[str, object]:
    by_code: dict[str, dict[str, object]] = {}
    for row in rows:
        code = row["Station Code"]
        station = by_code.setdefault(
            code,
            {
                "code": code,
                "nameZh": row["Chinese Name"].translate(QUERY_CHAR),
                "nameEn": row["English Name"],
                "lines": set(),
                "offRoute": False,
            },
        )
        lines = station["lines"]
        assert isinstance(lines, set)
        lines.add(row["Line Code"])

    racecourse = geocode("馬場", cache)
    rac_lon, rac_lat = TO_WGS84.transform(float(racecourse["x"]), float(racecourse["y"]))
    by_code["RAC"] = {
        "code": "RAC",
        "nameZh": "馬場",
        "nameEn": "Racecourse",
        "lines": {"EAL"},
        "offRoute": True,
        "lon": round(rac_lon, 6),
        "lat": round(rac_lat, 6),
    }

    for code, station in by_code.items():
        if code == "RAC":
            continue
        found = geocode(str(station["nameZh"]), cache)
        lon, lat = TO_WGS84.transform(float(found["x"]), float(found["y"]))
        station["lon"] = round(lon, 6)
        station["lat"] = round(lat, 6)

    grouped: dict[str, dict[str, list[tuple[float, str]]]] = {}
    for row in rows:
        grouped.setdefault(row["Line Code"], {}).setdefault(row["Direction"], []).append(
            (float(row["Sequence"]), row["Station Code"])
        )

    line_paths: dict[str, list[list[str]]] = {}
    for line_code, directions in grouped.items():
        ordered = {
            name: [code for _, code in sorted(pairs)]
            for name, pairs in directions.items()
        }
        trunk = choose_trunk(ordered)
        line_paths[line_code] = [trunk, *branch_paths(ordered, trunk)]

    stations = []
    for station in by_code.values():
        lines = sorted(station["lines"], key=lambda item: LINE_ORDER[str(item)])
        stations.append(
            {
                "code": station["code"],
                "nameZh": station["nameZh"],
                "nameEn": station["nameEn"],
                "lon": station["lon"],
                "lat": station["lat"],
                "lines": lines,
                "offRoute": station["offRoute"],
            }
        )
    stations.sort(key=lambda item: str(item["nameZh"]))

    lines = []
    for code, name_zh, name_en, color, offset in LINE_META:
        lines.append(
            {
                "code": code,
                "nameZh": name_zh,
                "nameEn": name_en,
                "color": color,
                "offset": offset,
                "paths": line_paths[code],
            }
        )

    return {
        "generatedAt": datetime.now(HK).isoformat(timespec="seconds"),
        "coordinateSource": "https://www.map.gov.hk/gs/api/v1.0.0/locationSearch",
        "lineSource": LINES_URL,
        "stations": stations,
        "lines": lines,
    }


def clean_description(description: str, key: str) -> str:
    text = description.strip()
    suffix = f"[{key}]"
    if text.endswith(suffix):
        text = text[: -len(suffix)].strip()
    return text


def build_cameras() -> dict[str, object]:
    raw = fetch(CAMERAS_URL, "hk-smart-map/0.1")
    text = raw.decode("utf-16").lstrip("\ufeff")
    rows = list(csv.DictReader(io.StringIO(text), delimiter="\t"))
    cameras = []
    rejected = []
    for row in rows:
        key = row["key"].strip()
        url = row["url"].strip()
        try:
            lat = float(row["latitude"])
            lon = float(row["longitude"])
        except ValueError:
            rejected.append(key)
            continue
        if not (22.1 <= lat <= 22.6 and 113.8 <= lon <= 114.5):
            rejected.append(key)
            continue
        if not url.lower().startswith("https://tdcctv.data.one.gov.hk/") or not url.lower().endswith(".jpg"):
            rejected.append(key)
            continue
        cameras.append(
            {
                "key": key,
                "region": row["region"].strip(),
                "district": row["district"].strip(),
                "description": clean_description(row["description"], key),
                "lon": round(lon, 6),
                "lat": round(lat, 6),
                "url": url,
            }
        )
    if rejected:
        raise RuntimeError(f"rejected cameras: {rejected[:10]}")
    return {
        "fetchedAt": datetime.now(HK).isoformat(timespec="seconds"),
        "source": CAMERAS_URL,
        "cameras": cameras,
    }


def validate(network: dict[str, object], cameras: dict[str, object]) -> None:
    stations = {station["code"]: station for station in network["stations"]}  # type: ignore[index]
    if len(stations) != 98:
        raise RuntimeError(f"expected 98 stations, got {len(stations)}")
    if "RAC" not in stations or not stations["RAC"]["offRoute"]:
        raise RuntimeError("Racecourse station missing")
    for line in network["lines"]:  # type: ignore[index]
        for path in line["paths"]:
            if line["code"] != "EAL" and "RAC" in path:
                raise RuntimeError("Racecourse was inserted into a line")
            if "RAC" in path:
                raise RuntimeError("Racecourse must stay off the drawn East Rail line")
            if len(path) < 2:
                raise RuntimeError(f"short path on {line['code']}")
            for code in path:
                station = stations.get(code)
                if station is None:
                    raise RuntimeError(f"path station {code} missing")
                if not (22.1 <= station["lat"] <= 22.6 and 113.8 <= station["lon"] <= 114.5):
                    raise RuntimeError(f"station {code} is outside Hong Kong")
    camera_rows = cameras["cameras"]
    if len(camera_rows) < 900:  # type: ignore[arg-type]
        raise RuntimeError(f"too few cameras: {len(camera_rows)}")  # type: ignore[arg-type]


def main() -> None:
    NETWORK_PATH.parent.mkdir(parents=True, exist_ok=True)
    rows = load_lines()
    cache = load_cache()
    network = build_network(rows, cache)
    cameras = build_cameras()
    validate(network, cameras)
    NETWORK_PATH.write_text(json.dumps(network, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    CAMERAS_PATH.write_text(json.dumps(cameras, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"stations {len(network['stations'])}")  # type: ignore[arg-type]
    print(f"lines {len(network['lines'])}")  # type: ignore[arg-type]
    for line in network["lines"]:  # type: ignore[index]
        print(line["code"], [len(path) for path in line["paths"]], line["paths"])
    print(f"cameras {len(cameras['cameras'])}")  # type: ignore[arg-type]
    print(f"wrote {NETWORK_PATH}")
    print(f"wrote {CAMERAS_PATH}")


if __name__ == "__main__":
    main()
