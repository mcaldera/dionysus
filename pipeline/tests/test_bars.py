import json
import re

import pytest

from common import INTERIM

PATH = INTERIM / "bars.json"
pytestmark = pytest.mark.skipif(not PATH.exists(), reason="run 02_import_bars.py and 03_match_official.py first")


@pytest.fixture(scope="module")
def data():
    return json.loads(PATH.read_text(encoding="utf-8"))


def test_district_and_coordinates(data):
    for b in data["bars"]:
        assert 1 <= b["district"] <= 23, b["name"]
        assert 48.09 <= b["lat"] <= 48.35 and 16.15 <= b["lon"] <= 16.61, b["name"]


def test_stable_unique_ids(data):
    ids = [b["id"] for b in data["bars"]]
    assert len(ids) == len(set(ids))
    assert all(re.fullmatch(r"osm:(node|way|relation)/\d+|own:[a-z0-9-]+", i) for i in ids)


def test_venue_types(data):
    assert {b["venueType"] for b in data["bars"]} <= {"pub_bar", "tschocherl", "beisl_wirtshaus", "heuriger", "special"}


def test_every_official_venue_is_a_bar(data):
    ids = {b["id"] for b in data["bars"]}
    assert all(r["bar_id"] in ids for r in data["official"])


def test_listed_district_wins_for_official_bars(data):
    by_id = {b["id"]: b for b in data["bars"]}
    for r in data["official"]:
        assert by_id[r["bar_id"]]["district"] == r["listed_district"], r["name"]
