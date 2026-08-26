#!/usr/bin/env node
"use strict";

const fs = require("fs");
const vm = require("vm");
global.window = global;
vm.runInThisContext(fs.readFileSync("data.js", "utf8"), { filename: "data.js" });
const solver = require("./solver.js");
const data = global.RAMSEY_ANNOUNCED_DATA;

let assertions = 0;
let maxResidual = 0;
let maxDefaultError = 0;
let maxSolveMs = 0;
let maxPreOdeDefect = 0;
let maxPostOdeDefect = 0;
let maxBrowserPolicyDefect = 0;

function assert(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function close(actual, expected, tolerance, label) {
  const error = Math.abs(actual - expected);
  maxDefaultError = Math.max(maxDefaultError, error);
  assert(error <= tolerance, `${label}: ${actual} vs ${expected} (erro ${error})`);
}

function finitePositive(values, label) {
  assert(values.every(value => Number.isFinite(value) && value > 0), `${label}: valor não positivo/finito`);
}

function trajectoryDefect(segment, A, eis) {
  let worst = 0;
  for (let i = 1; i < segment.t.length - 1; i += 1) {
    const dt = segment.t[i + 1] - segment.t[i - 1];
    const numerical = [
      (segment.k[i + 1] - segment.k[i - 1]) / dt,
      (segment.c[i + 1] - segment.c[i - 1]) / dt
    ];
    const model = solver.rhs(A, eis, segment.k[i], segment.c[i], data);
    worst = Math.max(worst, Math.abs(numerical[0] - model[0]), Math.abs(numerical[1] - model[1]));
  }
  return worst;
}

function checkSolution(result) {
  const p = result.parameters;
  finitePositive(result.pre.k, "pre.k");
  finitePositive(result.pre.c, "pre.c");
  finitePositive(result.post.k, "post.k");
  finitePositive(result.post.c, "post.c");
  maxResidual = Math.max(maxResidual, Math.abs(result.metrics.matchingResidual));
  assert(Math.abs(result.metrics.matchingResidual) < 1e-6, `matching alto: ${result.metrics.matchingResidual}`);
  assert(Math.abs(result.pre.t.at(-1) - p.T) < 1e-10, "trajetória pré não termina em T");
  assert(Math.abs(result.post.t[0] - p.T) < 1e-10, "trajetória pós não começa em T");
  assert(Math.abs(result.pre.c.at(-1) - result.post.c[0]) < 1e-12, "consumo descontínuo em T");
  if (p.kind === "destruction") {
    assert(Math.abs((result.post.k[0] - result.pre.k.at(-1)) + 0.5) < 1e-12, "salto de capital incorreto");
  } else {
    assert(Math.abs(result.post.k[0] - result.pre.k.at(-1)) < 1e-12, "capital descontínuo no switch de TFP");
  }
  const preA = p.kind === "tfp" && p.tfpTiming === "ends" ? p.A1 : p.A0;
  const postA = p.kind === "tfp" && p.tfpTiming === "starts" ? p.A1 : p.A0;
  const preDefect = trajectoryDefect(result.pre, preA, p.eis);
  const postDefect = trajectoryDefect(result.post, postA, p.eis);
  maxPreOdeDefect = Math.max(maxPreOdeDefect, preDefect);
  maxPostOdeDefect = Math.max(maxPostOdeDefect, postDefect);
  assert(preDefect < 1e-3, `resíduo EDO pré-evento alto no regime A=${preA}: ${preDefect}`);
  assert(postDefect < 1e-3, `resíduo EDO pós-evento alto no regime A=${postA}: ${postDefect}`);
  const target = p.kind === "destruction" || p.tfpTiming === "ends" ? result.steadyStates.A0 : result.steadyStates.A1;
  const startDistance = Math.hypot(result.post.k[0] - target.k, result.post.c[0] - target.c);
  const endDistance = Math.hypot(result.post.k.at(-1) - target.k, result.post.c.at(-1) - target.c);
  if (startDistance > 1e-5) {
    assert(endDistance <= 0.2 * startDistance + 1e-7, `convergência pós-evento fraca: ${endDistance / startDistance}`);
  } else {
    assert(endDistance < 2e-5, "trajetória já próxima do EE se afastou do alvo");
  }
}

const defaults = [
  [{ kind: "tfp", tfpTiming: "starts", T: 10, eis: 0.5, A0: 1, A1: 1.3, capitalLoss: 0.5 }, data.reference.metrics.future],
  [{ kind: "tfp", tfpTiming: "ends", T: 10, eis: 0.5, A0: 1, A1: 1.3, capitalLoss: 0.5 }, data.reference.metrics.temporary],
  [{ kind: "destruction", tfpTiming: "starts", T: 10, eis: 0.5, A0: 1, A1: 1.3, capitalLoss: 0.5 }, data.reference.metrics.destruction]
];

for (const [parameters, reference] of defaults) {
  const result = solver.solveExperiment(parameters, data);
  checkSolution(result);
  close(result.metrics.c0, reference.c0, 5e-4, `${parameters.kind}/${parameters.tfpTiming} c0`);
  close(result.event.kMinus, reference.kT ?? reference.kTMinus, 5e-4, `${parameters.kind}/${parameters.tfpTiming} kT`);
  close(result.event.cMinus, reference.cT, 5e-4, `${parameters.kind}/${parameters.tfpTiming} cT`);
  if (parameters.kind === "destruction") close(result.event.kPlus, reference.kTPlus, 5e-4, "destruction kT+");
}

for (const eis of [0.25, 0.5, 1.5]) {
  for (const T of [2, 20]) {
    for (const A0 of [0.8, 1.2]) {
      for (const A1 of [0.8, 1.5]) {
        for (const timing of ["starts", "ends"]) {
          const result = solver.solveExperiment({ kind: "tfp", tfpTiming: timing, T, eis, A0, A1, capitalLoss: 0.5 }, data);
          checkSolution(result);
        }
        const destruction = solver.solveExperiment({ kind: "destruction", tfpTiming: "starts", T, eis, A0, A1, capitalLoss: 0.5 }, data);
        checkSolution(destruction);
      }
    }
  }
}

let randomState = 0x5a17c9e3;
function random() {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return (randomState >>> 0) / 4294967296;
}
function interiorGridValue(min, max, step) {
  const count = Math.round((max - min) / step);
  const index = 1 + Math.floor(random() * (count - 1));
  return +(min + index * step).toFixed(2);
}

for (let i = 0; i < 128; i += 1) {
  const kind = i % 3 === 2 ? "destruction" : "tfp";
  const parameters = {
    kind,
    tfpTiming: i % 2 ? "ends" : "starts",
    T: interiorGridValue(2, 20, 0.5),
    eis: interiorGridValue(0.25, 1.5, 0.05),
    A0: interiorGridValue(0.8, 1.2, 0.05),
    A1: interiorGridValue(0.8, 1.5, 0.05),
    capitalLoss: 0.5
  };
  const started = Date.now();
  const result = solver.solveExperiment(parameters, data);
  maxSolveMs = Math.max(maxSolveMs, Date.now() - started);
  checkSolution(result);
}

const identity = solver.solveExperiment({ kind: "tfp", tfpTiming: "ends", T: 20, eis: 1.5, A0: 1.1, A1: 1.1, capitalLoss: 0.5 }, data);
assert(identity.diagnostics.identity, "A0=A1 não usou o caso identidade");
assert(identity.pre.k.every(value => value === identity.metrics.k0), "capital não ficou constante na identidade");
assert(identity.pre.c.every(value => value === identity.metrics.c0), "consumo não ficou constante na identidade");

for (const [eis, diagnostic] of Object.entries(data.normalizedPolicy.diagnostics)) {
  assert(diagnostic.defect < 5e-6, `defeito alto da política para EIS=${eis}: ${diagnostic.defect}`);
}

const normalizedX = data.normalizedPolicy.x;
const unitSteady = solver.steadyState(1, data);
let maxCorePolicyDefect = 0;
for (const [eisKey, normalizedC] of Object.entries(data.normalizedPolicy.byEis)) {
  const eis = Number(eisKey);
  for (let i = 0; i < normalizedX.length - 1; i += 1) {
    const xMid = 0.5 * (normalizedX[i] + normalizedX[i + 1]);
    const kMid = xMid * unitSteady.k;
    const cMid = 0.5 * (normalizedC[i] + normalizedC[i + 1]) * unitSteady.c;
    const slope = (normalizedC[i + 1] - normalizedC[i]) * unitSteady.c
      / ((normalizedX[i + 1] - normalizedX[i]) * unitSteady.k);
    const vector = solver.rhs(1, eis, kMid, cMid, data);
    const defect = Math.abs(slope * vector[0] - vector[1]) / unitSteady.c;
    maxBrowserPolicyDefect = Math.max(maxBrowserPolicyDefect, defect);
    if (xMid >= 0.15 && xMid <= 2.6) maxCorePolicyDefect = Math.max(maxCorePolicyDefect, defect);
  }
}
assert(maxBrowserPolicyDefect < 4e-5, `defeito da política linear no navegador alto: ${maxBrowserPolicyDefect}`);
assert(maxCorePolicyDefect < 8e-6, `defeito central da política linear no navegador alto: ${maxCorePolicyDefect}`);

console.log(JSON.stringify({
  status: "ok",
  assertions,
  maxMatchingResidual: maxResidual,
  maxDefaultMetricError: maxDefaultError,
  maxPreOdeDefect,
  maxPostOdeDefect,
  maxBrowserPolicyDefect,
  maxCorePolicyDefect,
  maxSampledSolveMs: maxSolveMs,
  sampledInteriorCases: 128
}, null, 2));
