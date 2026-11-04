import csv

import pytest

from common import INTERIM, OWN

# Listed under a district other than the one their postcode says.
DISTRICT_EXCEPTIONS = {
    "Restaurant Karl-Wirt",  # 2380 Perchtoldsdorf, listed under 23
    "Wiener Wirtschaft",     # 1040 address, October booklet lists it under 5
}


def rows(name):
    with open(OWN / name, encoding="utf-8") as f:
        return list(csv.DictReader(f))


@pytest.mark.parametrize("name", ["official_2026-04.csv", "official_2026-10.csv"])
def test_51_rows_and_every_district(name):
    r = rows(name)
    assert len(r) == 51
    assert {int(x["district"]) for x in r} == set(range(1, 24))


@pytest.mark.parametrize("name", ["official_2026-04.csv", "official_2026-10.csv"])
def test_postcode_matches_district(name):
    for x in rows(name):
        if x["name"] in DISTRICT_EXCEPTIONS:
            continue
        assert x["postcode"] == f"1{int(x['district']):02d}0", x["name"]


def test_official_points_have_coordinates_and_district():
    path = INTERIM / "official_points.csv"
    if not path.exists():
        pytest.skip("run pipeline/03_match_official.py first")
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            assert 1 <= int(r["listed_district"]) <= 23
            lat, lon = float(r["lat"]), float(r["lon"])
            assert 48.09 <= lat <= 48.35 and 16.15 <= lon <= 16.61, r["name"]
            if r["name"] not in DISTRICT_EXCEPTIONS:
                assert r["pip_district"] == r["listed_district"], r["name"]
