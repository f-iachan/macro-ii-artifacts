#!/usr/bin/env python3
"""Build the static data contract for the announced-events Ramsey laboratory.

The source notebook is executed in memory and never overwritten.  Its own
stable-manifold routine produces a normalized policy for each EIS value exposed
by the HTML.  Cobb-Douglas scaling then lets the browser recover policies for
every A0/A1 slider value without interpolation across productivity.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
from pathlib import Path

import numpy as np


HERE = Path(__file__).resolve().parent
TOPIC = HERE.parents[1]
NOTEBOOK = TOPIC / "ramsey_dinamica_comparativa.ipynb"
OUTPUT = HERE / "data.js"

EIS_VALUES = np.round(np.arange(0.25, 1.5001, 0.05), 2)
X_GRID = np.concatenate([
    np.linspace(0.08, 3.0, 701),
    np.linspace(3.01, 8.0, 500),
])


def execute_notebook() -> dict:
    notebook = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    namespace: dict = {"__name__": "__main__"}
    with contextlib.redirect_stdout(io.StringIO()):
        for cell in notebook["cells"]:
            if cell["cell_type"] != "code":
                continue
            exec(compile("".join(cell["source"]), str(NOTEBOOK), "exec"), namespace)
            if "plt" in namespace:
                namespace["plt"].show = lambda *args, **kwargs: None
                namespace["plt"].close("all")
    return namespace


def rounded(values, digits=8):
    return np.round(np.asarray(values, dtype=float), digits).tolist()


def resample(t, k, c, n=241):
    target = np.linspace(float(t[0]), float(t[-1]), n)
    return {
        "t": rounded(target, 6),
        "k": rounded(np.interp(target, t, k)),
        "c": rounded(np.interp(target, t, c)),
    }


def default_reference(ns: dict) -> dict:
    permanent_pre = resample(ns["t_pre_perm"], ns["y_pre_perm"][0], ns["y_pre_perm"][1])
    permanent_post = resample(ns["t_post_perm"], ns["y_post_perm"][0], ns["y_post_perm"][1])
    transient_pre = resample(ns["t_pre_trans"], ns["y_pre_trans"][0], ns["y_pre_trans"][1])
    transient_post = resample(ns["t_post_trans"], ns["y_post_trans"][0], ns["y_post_trans"][1])
    disaster_pre = resample(ns["t_pre_dis"], ns["y_pre_dis"][0], ns["y_pre_dis"][1])
    disaster_post = resample(ns["t_post_dis"], ns["y_post_dis"][0], ns["y_post_dis"][1])
    return {
        "parameters": {
            "T": float(ns["T_EVENTO"]),
            "eis": float(ns["EPSILON"]),
            "A0": float(ns["A0"]),
            "A1": float(ns["A1"]),
            "capitalLoss": float(ns["PERDA_K"]),
        },
        "metrics": {
            "future": {
                "c0": round(float(ns["c0_perm"]), 9),
                "kT": round(float(ns["kT_perm"]), 9),
                "cT": round(float(ns["cT_perm"]), 9),
                "matchingResidual": abs(float(ns["res_perm"])),
            },
            "temporary": {
                "c0": round(float(ns["c0_trans"]), 9),
                "kT": round(float(ns["kT_trans"]), 9),
                "cT": round(float(ns["cT_trans"]), 9),
                "matchingResidual": abs(float(ns["res_trans"])),
            },
            "destruction": {
                "c0": round(float(ns["c0_dis"]), 9),
                "kTMinus": round(float(ns["kT_minus"]), 9),
                "kTPlus": round(float(ns["kT_plus"]), 9),
                "cT": round(float(ns["cT_minus"]), 9),
                "matchingResidual": abs(float(ns["res_dis"])),
            },
        },
        "trajectories": {
            "future": {"pre": permanent_pre, "post": permanent_post},
            "temporary": {"pre": transient_pre, "post": transient_post},
            "destruction": {"pre": disaster_pre, "post": disaster_post},
        },
    }


def policy_family(ns: dict) -> tuple[dict, dict]:
    policies = {}
    diagnostics = {}
    for eis in EIS_VALUES:
        ns["EPSILON"] = float(eis)
        ns["THETA"] = 1.0 / float(eis)
        policy = ns["build_stable_policy"](1.0, k_max_factor=8.0, n=1800)
        k_star, c_star = ns["steady_state"](1.0)
        k_values = X_GRID * k_star
        c_values = np.asarray(policy(k_values), dtype=float)
        if not np.all(np.isfinite(c_values)) or np.any(c_values <= 0):
            raise RuntimeError(f"Invalid normalized policy for EIS={eis:.2f}")
        normalized = c_values / c_star
        key = f"{eis:.2f}"
        policies[key] = rounded(normalized)
        sample = np.linspace(0.15, 2.6, 500) * k_star
        diagnostics[key] = {
            "defect": ns["policy_defect"](policy, sample),
            "theta": round(1.0 / float(eis), 8),
        }
    return policies, diagnostics


def main() -> None:
    os.environ.setdefault("MPLCONFIGDIR", "/private/tmp/ramsey-mpl-cache")
    namespace = execute_notebook()
    reference = default_reference(namespace)
    policies, policy_diagnostics = policy_family(namespace)
    notebook_bytes = NOTEBOOK.read_bytes()
    payload = {
        "schemaVersion": 1,
        "source": {
            "notebook": NOTEBOOK.name,
            "sha256": hashlib.sha256(notebook_bytes).hexdigest(),
            "buildScriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "principle": "The executed notebook is the quantitative oracle.",
        },
        "calibration": {
            "alpha": float(namespace["ALPHA"]),
            "delta": float(namespace["DELTA"]),
            "rho": float(namespace["RHO"]),
        },
        "ranges": {
            "T": [2.0, 20.0, 0.5],
            "eis": [0.25, 1.5, 0.05],
            "A0": [0.8, 1.2, 0.05],
            "A1": [0.8, 1.5, 0.05],
            "capitalLoss": 0.5,
        },
        "normalizedPolicy": {
            "x": rounded(X_GRID),
            "byEis": policies,
            "diagnostics": policy_diagnostics,
        },
        "reference": reference,
    }
    text = "globalThis.RAMSEY_ANNOUNCED_DATA = " + json.dumps(
        payload, ensure_ascii=False, separators=(",", ":")
    ) + ";\n"
    OUTPUT.write_text(text, encoding="utf-8")
    print(f"Wrote {OUTPUT} ({len(text):,} bytes)")


if __name__ == "__main__":
    main()
