#!/usr/bin/env python3
"""Generate policy and invariant-distribution data for the teaching artifact.

The artifact itself is intentionally about economic intuition.  This script keeps
the numerical method auditable: a monotone upwind discretization of the coupled HJB
is solved by Howard policy iteration; the invariant distribution is the stationary
distribution of the resulting continuous-time generator.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.integrate import solve_ivp
from scipy.sparse import bmat, csc_matrix, diags, eye, lil_matrix
from scipy.sparse.linalg import spsolve


ALPHA = 0.33
DELTA = 0.08
RHO = 0.04
THETA = 2.0
A_VALUES = (1.0, 1.3)
K_MIN = 0.55
K_MAX = 10.5
N_K = 520

PRESETS = (
    ("persistente", "Regimes persistentes", 0.06, 0.09),
    ("base", "Calibração-base", 0.12, 0.18),
    ("rapida", "Transições rápidas", 0.30, 0.45),
)


def utility(c: np.ndarray) -> np.ndarray:
    return np.power(c, 1.0 - THETA) / (1.0 - THETA)


def marginal_utility(c: np.ndarray) -> np.ndarray:
    return np.power(c, -THETA)


def inv_marginal_utility(x: np.ndarray) -> np.ndarray:
    return np.power(np.maximum(x, 1e-12), -1.0 / THETA)


def net_output(k: np.ndarray, productivity: float) -> np.ndarray:
    return productivity * np.power(k, ALPHA) - DELTA * k


def steady_state(productivity: float) -> tuple[float, float]:
    k_star = (ALPHA * productivity / (RHO + DELTA)) ** (1.0 / (1.0 - ALPHA))
    c_star = productivity * k_star**ALPHA - DELTA * k_star
    return float(k_star), float(c_star)


def stable_slope(productivity: float) -> float:
    k_star, c_star = steady_state(productivity)
    jacobian = np.array(
        [
            [ALPHA * productivity * k_star ** (ALPHA - 1.0) - DELTA, -1.0],
            [
                (1.0 / THETA)
                * ALPHA
                * productivity
                * (ALPHA - 1.0)
                * k_star ** (ALPHA - 2.0)
                * c_star,
                0.0,
            ],
        ]
    )
    values, vectors = np.linalg.eig(jacobian)
    index = int(np.argmin(values.real))
    vector = vectors[:, index].real
    if vector[0] < 0:
        vector *= -1
    return float(vector[1] / vector[0])


def deterministic_arm(productivity: float, evaluation_grid: np.ndarray) -> np.ndarray:
    """Compute the two branches of the deterministic Ramsey saddle path."""

    k_star, c_star = steady_state(productivity)
    slope = stable_slope(productivity)
    epsilon = 1.0 / THETA
    h = 2e-6 * k_star

    def dc_dk(k: float, c: np.ndarray) -> list[float]:
        consumption = float(c[0])
        k_dot = productivity * k**ALPHA - DELTA * k - consumption
        c_dot = (
            epsilon
            * (ALPHA * productivity * k ** (ALPHA - 1.0) - DELTA - RHO)
            * consumption
        )
        return [c_dot / k_dot]

    left_grid = evaluation_grid[evaluation_grid < k_star]
    right_grid = evaluation_grid[evaluation_grid > k_star]
    left = solve_ivp(
        dc_dk,
        (k_star - h, float(evaluation_grid[0])),
        [c_star - slope * h],
        t_eval=left_grid[::-1],
        rtol=2e-10,
        atol=2e-12,
        method="DOP853",
    )
    right = solve_ivp(
        dc_dk,
        (k_star + h, float(evaluation_grid[-1])),
        [c_star + slope * h],
        t_eval=right_grid,
        rtol=2e-10,
        atol=2e-12,
        method="DOP853",
    )
    if not left.success or not right.success:
        raise RuntimeError("Could not construct deterministic stable arm")

    result = np.empty_like(evaluation_grid)
    result[evaluation_grid < k_star] = left.y[0, ::-1]
    result[evaluation_grid > k_star] = right.y[0]
    nearest = int(np.argmin(np.abs(evaluation_grid - k_star)))
    if evaluation_grid[nearest] == k_star:
        result[nearest] = c_star
    else:
        # The regular solution is smooth at the saddle; interpolate over the tiny gap.
        valid = np.isfinite(result)
        result[~valid] = np.interp(evaluation_grid[~valid], evaluation_grid[valid], result[valid])
    return result


@dataclass
class HJBSolution:
    k: np.ndarray
    value: np.ndarray
    consumption: np.ndarray
    drift: np.ndarray
    generator: csc_matrix
    iterations: int
    residual: float


def policy_generator(drift: np.ndarray, step: float) -> csc_matrix:
    """Generator for deterministic motion on the capital grid."""

    n = len(drift)
    matrix = lil_matrix((n, n))
    for row, speed in enumerate(drift):
        if speed > 0 and row < n - 1:
            rate = speed / step
            matrix[row, row + 1] = rate
            matrix[row, row] = -rate
        elif speed < 0 and row > 0:
            rate = -speed / step
            matrix[row, row - 1] = rate
            matrix[row, row] = -rate
    return matrix.tocsc()


def solve_hjb(lambda_low_high: float, lambda_high_low: float) -> HJBSolution:
    k = np.linspace(K_MIN, K_MAX, N_K)
    step = float(k[1] - k[0])
    income = np.vstack([net_output(k, productivity) for productivity in A_VALUES])
    value = np.vstack([utility(income[i]) / RHO for i in range(2)])
    lambdas = (lambda_low_high, lambda_high_low)
    identity = eye(2 * N_K, format="csc")

    for iteration in range(1, 401):
        policies = []
        drifts = []
        generators = []
        for state in range(2):
            v = value[state]
            derivative_forward = np.empty(N_K)
            derivative_backward = np.empty(N_K)
            derivative_forward[:-1] = np.diff(v) / step
            derivative_backward[1:] = np.diff(v) / step
            derivative_forward[-1] = marginal_utility(income[state, -1])
            derivative_backward[0] = marginal_utility(income[state, 0])

            consumption_forward = inv_marginal_utility(derivative_forward)
            consumption_backward = inv_marginal_utility(derivative_backward)
            drift_forward = income[state] - consumption_forward
            drift_backward = income[state] - consumption_backward

            use_forward = drift_forward > 1e-10
            use_backward = drift_backward < -1e-10
            ambiguous = use_forward & use_backward
            if np.any(ambiguous):
                # Pick the derivative with the larger Hamiltonian.
                h_forward = utility(consumption_forward) + derivative_forward * drift_forward
                h_backward = utility(consumption_backward) + derivative_backward * drift_backward
                use_forward[ambiguous] = h_forward[ambiguous] >= h_backward[ambiguous]
                use_backward[ambiguous] = ~use_forward[ambiguous]

            derivative = marginal_utility(income[state]).copy()
            derivative[use_forward] = derivative_forward[use_forward]
            derivative[use_backward & ~use_forward] = derivative_backward[use_backward & ~use_forward]
            consumption = inv_marginal_utility(derivative)
            drift = income[state] - consumption
            drift[0] = max(drift[0], 0.0)
            drift[-1] = min(drift[-1], 0.0)

            policies.append(consumption)
            drifts.append(drift)
            generators.append(policy_generator(drift, step))

        switch_low = diags(np.full(N_K, lambda_low_high), format="csc")
        switch_high = diags(np.full(N_K, lambda_high_low), format="csc")
        joint_generator = bmat(
            [
                [generators[0] - switch_low, switch_low],
                [switch_high, generators[1] - switch_high],
            ],
            format="csc",
        )
        flow_utility = np.concatenate([utility(policies[0]), utility(policies[1])])
        new_value = spsolve(RHO * identity - joint_generator, flow_utility).reshape(2, N_K)
        change = float(np.max(np.abs(new_value - value)))
        value = 0.92 * new_value + 0.08 * value
        if change < 2e-9:
            break
    else:
        raise RuntimeError("Howard iteration did not converge")

    # Recompute the policy and generator from the converged value once more.
    policies = []
    drifts = []
    generators = []
    for state in range(2):
        v = value[state]
        derivative_forward = np.r_[np.diff(v) / step, marginal_utility(income[state, -1])]
        derivative_backward = np.r_[marginal_utility(income[state, 0]), np.diff(v) / step]
        consumption_forward = inv_marginal_utility(derivative_forward)
        consumption_backward = inv_marginal_utility(derivative_backward)
        drift_forward = income[state] - consumption_forward
        drift_backward = income[state] - consumption_backward
        use_forward = drift_forward > 1e-10
        use_backward = drift_backward < -1e-10
        ambiguous = use_forward & use_backward
        if np.any(ambiguous):
            h_forward = utility(consumption_forward) + derivative_forward * drift_forward
            h_backward = utility(consumption_backward) + derivative_backward * drift_backward
            use_forward[ambiguous] = h_forward[ambiguous] >= h_backward[ambiguous]
            use_backward[ambiguous] = ~use_forward[ambiguous]
        derivative = marginal_utility(income[state]).copy()
        derivative[use_forward] = derivative_forward[use_forward]
        derivative[use_backward & ~use_forward] = derivative_backward[use_backward & ~use_forward]
        consumption = inv_marginal_utility(derivative)
        drift = income[state] - consumption
        drift[0] = max(drift[0], 0.0)
        drift[-1] = min(drift[-1], 0.0)
        policies.append(consumption)
        drifts.append(drift)
        generators.append(policy_generator(drift, step))

    switch_low = diags(np.full(N_K, lambda_low_high), format="csc")
    switch_high = diags(np.full(N_K, lambda_high_low), format="csc")
    joint_generator = bmat(
        [
            [generators[0] - switch_low, switch_low],
            [switch_high, generators[1] - switch_high],
        ],
        format="csc",
    )
    stacked_value = value.reshape(-1)
    stacked_utility = np.concatenate([utility(policies[0]), utility(policies[1])])
    residual = float(
        np.max(np.abs(RHO * stacked_value - stacked_utility - joint_generator @ stacked_value))
    )
    return HJBSolution(
        k=k,
        value=value,
        consumption=np.vstack(policies),
        drift=np.vstack(drifts),
        generator=joint_generator,
        iterations=iteration,
        residual=residual,
    )


def stationary_mass(generator: csc_matrix) -> np.ndarray:
    """Solve G' m = 0 with sum(m)=1 by replacing one equation."""

    transpose = generator.transpose().tolil()
    rhs = np.zeros(transpose.shape[0])
    transpose[0, :] = np.ones(transpose.shape[1])
    rhs[0] = 1.0
    mass = spsolve(transpose.tocsc(), rhs)
    mass = np.maximum(np.asarray(mass), 0.0)
    mass /= mass.sum()
    return mass


def round_list(values: np.ndarray, digits: int = 6) -> list[float]:
    return np.round(np.asarray(values), digits).tolist()


def aggregate_distribution(
    values: np.ndarray,
    weights: np.ndarray,
    lower: float,
    upper: float,
    bins: int = 76,
) -> dict[str, list[float]]:
    edges = np.linspace(lower, upper, bins + 1)
    by_state = []
    for state in range(2):
        counts, _ = np.histogram(values[state], bins=edges, weights=weights[state])
        by_state.append(counts)
    centers = 0.5 * (edges[:-1] + edges[1:])
    return {"x": round_list(centers), "mass": [round_list(x, 8) for x in by_state]}


def main() -> None:
    output_grid = np.linspace(K_MIN, K_MAX, 360)
    deterministic = [deterministic_arm(a, output_grid) for a in A_VALUES]
    payload: dict[str, object] = {
        "meta": {
            "alpha": ALPHA,
            "delta": DELTA,
            "rho": RHO,
            "theta": THETA,
            "A": list(A_VALUES),
            "kMin": K_MIN,
            "kMax": K_MAX,
            "method": "Upwind HJB + Howard policy iteration; invariant mass from the policy generator",
        },
        "grid": round_list(output_grid),
        "deterministic": [round_list(x) for x in deterministic],
        "steadyStates": [
            {"k": round(steady_state(a)[0], 6), "c": round(steady_state(a)[1], 6)}
            for a in A_VALUES
        ],
        "presets": {},
    }

    for key, label, lambda_low_high, lambda_high_low in PRESETS:
        solution = solve_hjb(lambda_low_high, lambda_high_low)
        mass = stationary_mass(solution.generator).reshape(2, N_K)
        interpolated_c = np.vstack(
            [np.interp(output_grid, solution.k, solution.consumption[i]) for i in range(2)]
        )
        interpolated_drift = np.vstack(
            [np.interp(output_grid, solution.k, solution.drift[i]) for i in range(2)]
        )
        capital_distribution = aggregate_distribution(
            np.vstack([solution.k, solution.k]), mass, K_MIN, K_MAX
        )
        c_lower = float(np.min(solution.consumption))
        c_upper = float(np.max(solution.consumption))
        consumption_distribution = aggregate_distribution(
            solution.consumption, mass, c_lower, c_upper
        )
        payload["presets"][key] = {
            "label": label,
            "lambdaLowHigh": lambda_low_high,
            "lambdaHighLow": lambda_high_low,
            "meanLow": round(1.0 / lambda_low_high, 3),
            "meanHigh": round(1.0 / lambda_high_low, 3),
            "stationaryHigh": round(lambda_low_high / (lambda_low_high + lambda_high_low), 6),
            "policy": [round_list(x) for x in interpolated_c],
            "drift": [round_list(x) for x in interpolated_drift],
            "capitalDistribution": capital_distribution,
            "consumptionDistribution": consumption_distribution,
            "diagnostics": {
                "iterations": solution.iterations,
                "hjbResidual": solution.residual,
                "generatorResidual": float(np.max(np.abs(solution.generator.T @ mass.reshape(-1)))),
                "mass": float(mass.sum()),
            },
        }

    target = Path(__file__).with_name("data.js")
    target.write_text(
        "window.MARKOV_TFP_DATA = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {target}")
    for key, preset in payload["presets"].items():
        print(key, preset["diagnostics"])


if __name__ == "__main__":
    main()
