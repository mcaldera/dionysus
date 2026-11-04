import json

import numpy as np
import pytest

from common import INTERIM, ROOT

MATRICES = ["walk", "transit_p25", "transit_p50", "transit_p75"]
DIRS = [d for d in [INTERIM / "phase1", INTERIM / "phase1_no_sbahn", ROOT / "public" / "data" / "travel"]
        if (d / "manifest.json").exists() or (d.parent / "manifest.json").exists()]


@pytest.mark.skipif(not DIRS, reason="no matrices computed yet")
@pytest.mark.parametrize("d", DIRS, ids=lambda d: d.name)
@pytest.mark.parametrize("name", MATRICES)
def test_matrix_shape_and_diagonal(d, name):
    manifest = d / "manifest.json" if (d / "manifest.json").exists() else d.parent / "manifest.json"
    n = json.loads(manifest.read_text())["n"]
    data = (d / f"{name}.bin").read_bytes()
    assert len(data) == n * n
    m = np.frombuffer(data, dtype=np.uint8).reshape(n, n)
    assert (np.diag(m) == 0).all()


@pytest.mark.skipif(not DIRS, reason="no matrices computed yet")
@pytest.mark.parametrize("d", DIRS, ids=lambda d: d.name)
def test_transit_quantiles_ordered(d):
    m = {k: np.frombuffer((d / f"{k}.bin").read_bytes(), dtype=np.uint8) for k in MATRICES}
    ok = m["transit_p75"] != 255
    assert (m["transit_p25"][ok] <= m["transit_p50"][ok]).all()
    assert (m["transit_p50"][ok] <= m["transit_p75"][ok]).all()
