from common import ROOT


def test_no_website_text_in_public():
    public = ROOT / "public"
    assert not any("website_text" in str(p) for p in public.rglob("*"))


def test_every_published_bar_has_a_matrix_index():
    import json

    import pytest

    bars_path = ROOT / "public" / "data" / "bars.json"
    if not bars_path.exists():
        pytest.skip("run 07_build_site_data.py first")
    bars = json.loads(bars_path.read_text(encoding="utf-8"))
    manifest = json.loads((ROOT / "public" / "data" / "manifest.json").read_text(encoding="utf-8"))
    idx = [b["matrixIndex"] for b in bars]
    # Hidden bars keep their matrix rows, so indices are unique and in range but may have gaps.
    assert len(set(idx)) == len(idx) and all(0 <= i < manifest["n"] for i in idx)
    assert all(manifest["order"][b["matrixIndex"]] == b["id"] for b in bars)
    size = (ROOT / "public" / "data" / "travel" / "walk.bin").stat().st_size
    assert size == manifest["n"] ** 2


def test_private_gmaps_snapshot_never_published():
    import json

    # data/interim/gmaps/ is a private Google Maps snapshot. Only gmaps.py export crosses over:
    # place ids (google_place_ids.csv), permanent closures (hidden in overrides.csv) and a
    # few 0-100 scores (google_scores.csv).
    build = (ROOT / "pipeline" / "07_build_site_data.py").read_text(encoding="utf-8")
    assert "gmaps" not in build
    public = ROOT / "public"
    assert not any("gmaps" in str(p) for p in public.rglob("*"))
    bars_path = public / "data" / "bars.json"
    if bars_path.exists():
        text = bars_path.read_text(encoding="utf-8")
        assert "review_rating" not in text and "popular_times" not in text
        # Only the place id and our 0-100 scores cross over, no Google numbers or text.
        bars = json.loads(text)
        assert not any(k in b for b in bars for k in ("rating", "reviews", "reviewCount", "photos", "popularTimes"))


def test_place_id_export_has_only_ids():
    import csv

    path = ROOT / "data" / "own" / "google_place_ids.csv"
    if path.exists():
        with open(path, encoding="utf-8") as f:
            assert csv.DictReader(f).fieldnames == ["bar_id", "place_id"]
    path = ROOT / "data" / "own" / "google_scores.csv"
    if path.exists():
        with open(path, encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        assert list(rows[0]) == ["bar_id", "popularity", "satisfaction", "geheimtipp", "polarizing"]
        assert all(0 <= int(v) <= 100 for r in rows for k, v in r.items() if k != "bar_id")
