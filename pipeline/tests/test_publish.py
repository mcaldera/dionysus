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
