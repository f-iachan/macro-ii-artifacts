(function (root) {
  "use strict";

  function steadyState({ alpha, beta, delta }) {
    const rbar = 1 / beta - 1;
    const kappa = beta * (rbar + delta);
    const yOverK = (rbar + delta) / alpha;
    const sI = delta / yOverK;
    return { rbar, kappa, sI, sC: 1 - sI };
  }

  function coefficients(psiLK, psiLz, parameters) {
    const { alpha, sigma, zeta, delta } = parameters;
    const { sC, sI } = steadyState(parameters);
    const psiCK = (alpha - (zeta + alpha) * psiLK) / sigma;
    const psiCz = (1 - (zeta + alpha) * psiLz) / sigma;
    const psiYK = alpha + (1 - alpha) * psiLK;
    const psiYz = 1 + (1 - alpha) * psiLz;
    const psiIK = (psiYK - sC * psiCK) / sI;
    const psiIz = (psiYz - sC * psiCz) / sI;
    const lambda = 1 - delta + delta * psiIK;
    return {
      psiLK, psiLz, psiCK, psiCz, psiIK, psiIz, psiYK, psiYz, lambda
    };
  }

  function residuals(psiLK, psiLz, parameters) {
    const { alpha, sigma, delta, rho } = parameters;
    const { kappa } = steadyState(parameters);
    const c = coefficients(psiLK, psiLz, parameters);
    const rK = alpha - 1 + (1 - alpha) * psiLK;
    const f1 = c.psiCK * (c.lambda - 1)
      - (kappa / sigma) * rK * c.lambda;
    const f2 = c.psiCK * delta * c.psiIz + c.psiCz * (rho - 1)
      - (kappa / sigma) * (
        rho + rK * delta * c.psiIz + (1 - alpha) * psiLz * rho
      );
    return [f1, f2];
  }

  function maxAbs(values) {
    return Math.max(...values.map((value) => Math.abs(value)));
  }

  function solve(parameters, initial = [0, 0]) {
    let x = initial.slice();
    let iterations = 0;

    for (; iterations < 60; iterations += 1) {
      const f = residuals(x[0], x[1], parameters);
      const norm = maxAbs(f);
      if (!Number.isFinite(norm)) break;
      if (norm < 1e-11) {
        const c = coefficients(x[0], x[1], parameters);
        return { ok: true, iterations: iterations + 1, residual: norm, coefficients: c };
      }

      const h0 = 1e-6 * (1 + Math.abs(x[0]));
      const h1 = 1e-6 * (1 + Math.abs(x[1]));
      const f0 = residuals(x[0] + h0, x[1], parameters);
      const f1 = residuals(x[0], x[1] + h1, parameters);
      const j00 = (f0[0] - f[0]) / h0;
      const j10 = (f0[1] - f[1]) / h0;
      const j01 = (f1[0] - f[0]) / h1;
      const j11 = (f1[1] - f[1]) / h1;
      const determinant = j00 * j11 - j01 * j10;
      if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-13) break;

      const step0 = (j11 * f[0] - j01 * f[1]) / determinant;
      const step1 = (-j10 * f[0] + j00 * f[1]) / determinant;
      let accepted = false;
      let scale = 1;
      for (let backtrack = 0; backtrack < 12; backtrack += 1) {
        const candidate = [x[0] - scale * step0, x[1] - scale * step1];
        const candidateNorm = maxAbs(residuals(candidate[0], candidate[1], parameters));
        if (Number.isFinite(candidateNorm) && candidateNorm < norm) {
          x = candidate;
          accepted = true;
          break;
        }
        scale *= 0.5;
      }
      if (!accepted) break;
    }

    const residual = maxAbs(residuals(x[0], x[1], parameters));
    return {
      ok: false,
      iterations,
      residual,
      coefficients: coefficients(x[0], x[1], parameters)
    };
  }

  function impulseResponse(parameters, c, horizon = 60, shock = 1) {
    const { delta, rho } = parameters;
    const z = Array(horizon).fill(0);
    const capital = Array(horizon + 1).fill(0);
    z[0] = shock;
    for (let t = 1; t < horizon; t += 1) z[t] = rho * z[t - 1];
    for (let t = 0; t < horizon; t += 1) {
      capital[t + 1] = c.lambda * capital[t] + delta * c.psiIz * z[t];
    }

    const output = [];
    const consumption = [];
    const investment = [];
    const labor = [];
    for (let t = 0; t < horizon; t += 1) {
      output.push(c.psiYK * capital[t] + c.psiYz * z[t]);
      consumption.push(c.psiCK * capital[t] + c.psiCz * z[t]);
      investment.push(c.psiIK * capital[t] + c.psiIz * z[t]);
      labor.push(c.psiLK * capital[t] + c.psiLz * z[t]);
    }
    return {
      output,
      consumption,
      investment,
      labor,
      capital: capital.slice(0, horizon),
      productivity: z
    };
  }

  root.RBCSolver = { steadyState, coefficients, residuals, solve, impulseResponse };
})(typeof window === "undefined" ? globalThis : window);
