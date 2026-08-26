(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RamseyAnnouncedSolver = api;
}(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  var POST_HORIZON = 38;
  var CAPITAL_FLOOR = 1e-8;

  function assertData(data) {
    if (!data || data.schemaVersion !== 1 || !data.normalizedPolicy) {
      throw new Error("Contrato numérico ausente ou incompatível.");
    }
  }

  function steadyState(A, data) {
    var alpha = data.calibration.alpha;
    var delta = data.calibration.delta;
    var rho = data.calibration.rho;
    var k = Math.pow(alpha * A / (rho + delta), 1 / (1 - alpha));
    var c = A * Math.pow(k, alpha) - delta * k;
    return { k: k, c: c };
  }

  function rhs(A, eis, k, c, data) {
    var alpha = data.calibration.alpha;
    var delta = data.calibration.delta;
    var rho = data.calibration.rho;
    if (!(k > CAPITAL_FLOOR) || !(c > CAPITAL_FLOOR)) return [NaN, NaN];
    return [
      A * Math.pow(k, alpha) - delta * k - c,
      eis * (alpha * A * Math.pow(k, alpha - 1) - delta - rho) * c
    ];
  }

  function interpolate(x, y, value) {
    if (value < x[0] || value > x[x.length - 1]) return NaN;
    if (value === x[0]) return y[0];
    if (value === x[x.length - 1]) return y[y.length - 1];
    var lo = 0;
    var hi = x.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (x[mid] <= value) lo = mid;
      else hi = mid;
    }
    var weight = (value - x[lo]) / (x[hi] - x[lo]);
    return y[lo] * (1 - weight) + y[hi] * weight;
  }

  function policyFor(A, eis, data) {
    var key = Number(eis).toFixed(2);
    var normalized = data.normalizedPolicy.byEis[key];
    if (!normalized) throw new Error("EIS fora da malha pré-computada: " + key);
    var x = data.normalizedPolicy.x;
    var ss = steadyState(A, data);
    var policy = function (k) {
      var normalizedValue = interpolate(x, normalized, k / ss.k);
      return Number.isFinite(normalizedValue) ? ss.c * normalizedValue : NaN;
    };
    policy.A = A;
    policy.eis = eis;
    policy.ss = ss;
    policy.domain = [x[0] * ss.k, x[x.length - 1] * ss.k];
    policy.sample = function (n) {
      var k = [];
      var c = [];
      if (!n) {
        for (var gridIndex = 0; gridIndex < x.length; gridIndex += 1) {
          k.push(x[gridIndex] * ss.k);
          c.push(normalized[gridIndex] * ss.c);
        }
        return { k: k, c: c };
      }
      var count = n;
      for (var i = 0; i < count; i += 1) {
        var kval = policy.domain[0] + i / (count - 1) * (policy.domain[1] - policy.domain[0]);
        k.push(kval);
        c.push(policy(kval));
      }
      return { k: k, c: c };
    };
    return policy;
  }

  function combine(base, h, coefficients, derivatives) {
    return base.map(function (value, dimension) {
      var increment = 0;
      for (var i = 0; i < coefficients.length; i += 1) {
        increment += coefficients[i] * derivatives[i][dimension];
      }
      return value + h * increment;
    });
  }

  function rk45Step(fn, t, y, h) {
    var k1 = fn(t, y);
    var k2 = fn(t + h / 5, combine(y, h, [1 / 5], [k1]));
    var k3 = fn(t + 3 * h / 10, combine(y, h, [3 / 40, 9 / 40], [k1, k2]));
    var k4 = fn(t + 4 * h / 5, combine(y, h, [44 / 45, -56 / 15, 32 / 9], [k1, k2, k3]));
    var k5 = fn(t + 8 * h / 9, combine(y, h, [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729], [k1, k2, k3, k4]));
    var k6 = fn(t + h, combine(y, h, [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [k1, k2, k3, k4, k5]));
    var y5 = combine(y, h, [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84], [k1, k2, k3, k4, k5, k6]);
    var k7 = fn(t + h, y5);
    var y4 = combine(y, h, [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40], [k1, k2, k3, k4, k5, k6, k7]);
    return { value: y5, embedded: y4 };
  }

  function integrateAdaptive(fn, y0, duration, options) {
    var opts = options || {};
    var rtol = opts.rtol || 2e-8;
    var atol = opts.atol || 2e-10;
    var maxStep = opts.maxStep || 0.08;
    var minStep = opts.minStep || 1e-7;
    var maxAttempts = opts.maxAttempts || 20000;
    var record = opts.record !== false;
    var t = 0;
    var y = y0.slice();
    var h = Math.min(maxStep, Math.max(minStep, duration / 80));
    var times = record ? [0] : null;
    var values = record ? [y.slice()] : null;
    var evaluations = 0;
    var rejected = 0;
    var attempts = 0;
    while (t < duration - 1e-13) {
      attempts += 1;
      if (attempts > maxAttempts) {
        return { success: false, reason: "attempt-limit", t: t, y: y, evaluations: evaluations };
      }
      h = Math.min(h, duration - t);
      var step = rk45Step(fn, t, y, h);
      evaluations += 7;
      if (step.value.some(function (v) { return !Number.isFinite(v); })) {
        h *= 0.25;
        rejected += 1;
        if (h < minStep) return { success: false, reason: "nonfinite", t: t, y: y, evaluations: evaluations };
        continue;
      }
      var error = 0;
      for (var i = 0; i < y.length; i += 1) {
        var scale = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(step.value[i]));
        error = Math.max(error, Math.abs(step.value[i] - step.embedded[i]) / scale);
      }
      if (error <= 1) {
        t += h;
        y = step.value;
        if (y.some(function (v) { return !(v > CAPITAL_FLOOR) || !Number.isFinite(v); })) {
          return { success: false, reason: "positivity", t: t, y: y, evaluations: evaluations };
        }
        if (record) {
          times.push(t);
          values.push(y.slice());
        }
        h *= error === 0 ? 2.5 : Math.min(2.5, Math.max(0.25, 0.9 * Math.pow(error, -0.2)));
      } else {
        h *= Math.max(0.15, 0.9 * Math.pow(error, -0.25));
        rejected += 1;
        if (h < minStep || rejected > 5000) {
          return { success: false, reason: "step-size", t: t, y: y, evaluations: evaluations };
        }
      }
      h = Math.min(maxStep, Math.max(minStep, h));
    }
    return { success: true, t: t, y: y, times: times, values: values, evaluations: evaluations };
  }

  function resample(result, startTime, count) {
    var targetT = [];
    var dimensions = result.values[0].length;
    var output = [];
    for (var d = 0; d < dimensions; d += 1) output.push([]);
    var cursor = 0;
    for (var i = 0; i < count; i += 1) {
      var relative = result.t * i / (count - 1);
      while (cursor < result.times.length - 2 && result.times[cursor + 1] < relative) cursor += 1;
      var leftT = result.times[cursor];
      var rightT = result.times[Math.min(cursor + 1, result.times.length - 1)];
      var weight = rightT === leftT ? 0 : (relative - leftT) / (rightT - leftT);
      targetT.push(startTime + relative);
      for (d = 0; d < dimensions; d += 1) {
        var left = result.values[cursor][d];
        var right = result.values[Math.min(cursor + 1, result.values.length - 1)][d];
        output[d].push(left * (1 - weight) + right * weight);
      }
    }
    return { t: targetT, values: output };
  }

  function brentRoot(fn, lower, upper, tolerance, maxIterations) {
    var a = lower;
    var b = upper;
    var fa = fn(a);
    var fb = fn(b);
    if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) throw new Error("Raiz sem bracket válido.");
    if (Math.abs(fa) < Math.abs(fb)) {
      var swap = a; a = b; b = swap;
      swap = fa; fa = fb; fb = swap;
    }
    var c = a;
    var fc = fa;
    var d = c;
    var mflag = true;
    var s = b;
    for (var iteration = 0; iteration < maxIterations; iteration += 1) {
      if (Math.abs(fb) <= tolerance || Math.abs(b - a) <= tolerance) {
        return { root: b, value: fb, iterations: iteration + 1 };
      }
      if (fa !== fc && fb !== fc) {
        s = a * fb * fc / ((fa - fb) * (fa - fc))
          + b * fa * fc / ((fb - fa) * (fb - fc))
          + c * fa * fb / ((fc - fa) * (fc - fb));
      } else {
        s = b - fb * (b - a) / (fb - fa);
      }
      var boundary = (3 * a + b) / 4;
      var condition1 = b > a ? (s < boundary || s > b) : (s > boundary || s < b);
      var condition2 = mflag && Math.abs(s - b) >= Math.abs(b - c) / 2;
      var condition3 = !mflag && Math.abs(s - b) >= Math.abs(c - d) / 2;
      var condition4 = mflag && Math.abs(b - c) < tolerance;
      var condition5 = !mflag && Math.abs(c - d) < tolerance;
      if (condition1 || condition2 || condition3 || condition4 || condition5 || !Number.isFinite(s)) {
        s = (a + b) / 2;
        mflag = true;
      } else {
        mflag = false;
      }
      var fs = fn(s);
      if (!Number.isFinite(fs)) {
        s = (a + b) / 2;
        fs = fn(s);
        mflag = true;
      }
      if (!Number.isFinite(fs)) throw new Error("Gap terminal não finito dentro do bracket.");
      d = c;
      c = b;
      fc = fb;
      if (fa * fs < 0) {
        b = s;
        fb = fs;
      } else {
        a = s;
        fa = fs;
      }
      if (Math.abs(fa) < Math.abs(fb)) {
        swap = a; a = b; b = swap;
        swap = fa; fa = fb; fb = swap;
      }
    }
    throw new Error("Shooting excedeu o limite de iterações.");
  }

  function scanBracket(gap, reference, lowFactor, highFactor, points) {
    var previousX = null;
    var previousF = null;
    var brackets = [];
    for (var i = 0; i < points; i += 1) {
      var x = reference * (lowFactor + i / (points - 1) * (highFactor - lowFactor));
      var fx = gap(x);
      if (Number.isFinite(fx)) {
        if (previousX !== null && previousF * fx <= 0) brackets.push([previousX, x]);
        previousX = x;
        previousF = fx;
      } else {
        previousX = null;
        previousF = null;
      }
    }
    if (!brackets.length) return null;
    brackets.sort(function (left, right) {
      return Math.abs((left[0] + left[1]) / 2 - reference) - Math.abs((right[0] + right[1]) / 2 - reference);
    });
    return brackets[0];
  }

  function scanDomainBrackets(fn, low, high, points) {
    var brackets = [];
    var previousX = null;
    var previousF = null;
    for (var i = 0; i < points; i += 1) {
      var share = i / (points - 1);
      var x = low + share * (high - low);
      var fx = fn(x);
      if (Number.isFinite(fx)) {
        if (previousX !== null && previousF * fx <= 0) brackets.push([previousX, x]);
        previousX = x;
        previousF = fx;
      } else {
        previousX = null;
        previousF = null;
      }
    }
    return brackets;
  }

  function reverseBackwardPath(raw, T, count) {
    var sample = resample(raw, 0, count);
    return {
      t: sample.t.map(function (s) { return T - s; }).reverse(),
      k: sample.values[0].slice().reverse(),
      c: sample.values[1].slice().reverse()
    };
  }

  function backwardMatching(k0, APre, eis, T, postPolicy, capitalLoss, cReference, data) {
    var evaluations = 0;
    var backwardGap = function (kPlus) {
      var cT = postPolicy(kPlus);
      if (!Number.isFinite(cT)) return NaN;
      var kMinus = kPlus + capitalLoss;
      var result = integrateAdaptive(function (time, y) {
        var vector = rhs(APre, eis, y[0], y[1], data);
        return [-vector[0], -vector[1]];
      }, [kMinus, cT], T, { record: false, rtol: 7e-8, atol: 7e-10, maxStep: 0.1, maxAttempts: 1800 });
      evaluations += result.evaluations || 0;
      return result.success ? result.y[0] - k0 : NaN;
    };
    var domainSpan = postPolicy.domain[1] - postPolicy.domain[0];
    var low = postPolicy.domain[0] + 0.015 * domainSpan;
    var high = postPolicy.domain[1] - 0.015 * domainSpan;
    var brackets = scanDomainBrackets(backwardGap, low, high, 180);
    if (!brackets.length) throw new Error("Nem o shooting reverso encontrou uma trajetória factível.");
    var candidates = [];
    brackets.forEach(function (bracket) {
      try {
        var root = brentRoot(backwardGap, bracket[0], bracket[1], 2e-10, 90);
        var kPlus = root.root;
        var cT = postPolicy(kPlus);
        var kMinus = kPlus + capitalLoss;
        var raw = integrateAdaptive(function (time, y) {
          var vector = rhs(APre, eis, y[0], y[1], data);
          return [-vector[0], -vector[1]];
        }, [kMinus, cT], T, { record: true, rtol: 2e-9, atol: 2e-11, maxStep: 0.05 });
        if (raw.success) {
          candidates.push({
            root: root,
            raw: raw,
            kPlus: kPlus,
            kMinus: kMinus,
            cT: cT,
            c0: raw.y[1],
            distance: Math.abs(raw.y[1] - cReference)
          });
        }
      } catch (error) {
        return;
      }
    });
    if (!candidates.length) throw new Error("O shooting reverso falhou ao reintegrar o candidato.");
    candidates.sort(function (left, right) { return left.distance - right.distance; });
    var best = candidates[0];
    best.pre = reverseBackwardPath(best.raw, T, Math.max(121, Math.round(T / 0.05) + 1));
    best.pre.k[0] = k0;
    best.pre.c[0] = best.c0;
    best.pre.k[best.pre.k.length - 1] = best.kMinus;
    best.pre.c[best.pre.c.length - 1] = best.cT;
    best.evaluations = evaluations + best.raw.evaluations;
    return best;
  }

  function flatSegment(start, duration, k, c, count) {
    var t = [];
    var capital = [];
    var consumption = [];
    for (var i = 0; i < count; i += 1) {
      t.push(start + duration * i / (count - 1));
      capital.push(k);
      consumption.push(c);
    }
    return { t: t, k: capital, c: consumption };
  }

  function solveExperiment(parameters, data) {
    assertData(data);
    var kind = parameters.kind;
    var timing = parameters.tfpTiming || "starts";
    var T = Number(parameters.T);
    var eis = Number(parameters.eis);
    var A0 = Number(parameters.A0);
    var A1 = Number(parameters.A1);
    var capitalLoss = Number(parameters.capitalLoss === undefined ? 0.5 : parameters.capitalLoss);
    if (kind !== "tfp" && kind !== "destruction") throw new Error("Experimento desconhecido.");
    var ss0 = steadyState(A0, data);
    var ss1 = steadyState(A1, data);
    var policy0 = policyFor(A0, eis, data);
    var policy1 = policyFor(A1, eis, data);
    var k0 = ss0.k;
    var isIdentity = kind === "tfp" && Math.abs(A0 - A1) < 1e-12;
    if (isIdentity) {
      return {
        parameters: { kind: kind, tfpTiming: timing, T: T, eis: eis, A0: A0, A1: A1, capitalLoss: capitalLoss },
        steadyStates: { A0: ss0, A1: ss1 },
        policies: { A0: policy0.sample(), A1: policy1.sample() },
        pre: flatSegment(0, T, k0, ss0.c, Math.max(81, Math.round(T / 0.05) + 1)),
        post: flatSegment(T, POST_HORIZON, k0, ss0.c, 381),
        event: { kMinus: k0, kPlus: k0, cMinus: ss0.c, cPlus: ss0.c },
        metrics: { k0: k0, cBaseline: ss0.c, c0: ss0.c, announcementJump: 0, matchingResidual: 0 },
        diagnostics: { identity: true, rootIterations: 0, evaluations: 0 }
      };
    }

    var APre;
    var postPolicy;
    var postA;
    var cReference;
    var jump;
    if (kind === "destruction") {
      APre = A0;
      postA = A0;
      postPolicy = policy0;
      cReference = ss0.c;
      jump = function (k) { return k - capitalLoss; };
    } else if (timing === "ends") {
      APre = A1;
      postA = A0;
      postPolicy = policy0;
      cReference = ss1.c;
      jump = function (k) { return k; };
    } else {
      APre = A0;
      postA = A1;
      postPolicy = policy1;
      cReference = ss0.c;
      jump = function (k) { return k; };
    }

    var rootEvaluations = 0;
    var gap = function (c0) {
      var result = integrateAdaptive(function (time, y) {
        return rhs(APre, eis, y[0], y[1], data);
      }, [k0, c0], T, { record: false, rtol: 7e-8, atol: 7e-10, maxStep: 0.1, maxAttempts: 1200 });
      rootEvaluations += result.evaluations || 0;
      if (!result.success) return NaN;
      var kPlus = jump(result.y[0]);
      if (!(kPlus > postPolicy.domain[0] && kPlus < postPolicy.domain[1])) return NaN;
      var targetC = postPolicy(kPlus);
      return Number.isFinite(targetC) ? result.y[1] - targetC : NaN;
    };
    var bracket = scanBracket(gap, cReference, 0.15, 1.85, 96)
      || scanBracket(gap, cReference, 0.04, 2.5, 160);
    var root;
    var c0;
    var preRaw;
    var pre;
    var kMinus;
    var cMinus;
    var kPlus;
    var matchingResidual;
    var solveMethod = "forward-c0";
    if (bracket) {
      root = brentRoot(gap, bracket[0], bracket[1], 2e-10, 90);
      c0 = root.root;
      preRaw = integrateAdaptive(function (time, y) {
        return rhs(APre, eis, y[0], y[1], data);
      }, [k0, c0], T, { record: true, rtol: 2e-9, atol: 2e-11, maxStep: 0.05 });
      if (!preRaw.success) throw new Error("Falha ao reintegrar a trajetória pré-evento.");
      var preSample = resample(preRaw, 0, Math.max(121, Math.round(T / 0.05) + 1));
      pre = { t: preSample.t, k: preSample.values[0], c: preSample.values[1] };
      kMinus = preRaw.y[0];
      cMinus = preRaw.y[1];
      kPlus = jump(kMinus);
      matchingResidual = cMinus - postPolicy(kPlus);
    } else {
      var lossBeforeLanding = kind === "destruction" ? capitalLoss : 0;
      var backward = backwardMatching(k0, APre, eis, T, postPolicy, lossBeforeLanding, cReference, data);
      root = backward.root;
      c0 = backward.c0;
      preRaw = backward.raw;
      pre = backward.pre;
      kMinus = backward.kMinus;
      cMinus = backward.cT;
      kPlus = backward.kPlus;
      matchingResidual = cMinus - postPolicy(kPlus);
      rootEvaluations += backward.evaluations;
      bracket = [NaN, NaN];
      solveMethod = "backward-terminal-k";
    }
    var postRaw = integrateAdaptive(function (time, y) {
      var kval = y[0];
      var cval = postPolicy(kval);
      return [postA * Math.pow(kval, data.calibration.alpha) - data.calibration.delta * kval - cval];
    }, [kPlus], POST_HORIZON, { record: true, rtol: 2e-9, atol: 2e-11, maxStep: 0.08 });
    if (!postRaw.success) throw new Error("Falha ao seguir a variedade estável pós-evento.");
    var postSample = resample(postRaw, T, 381);
    var postC = postSample.values[0].map(function (k) { return postPolicy(k); });
    var post = { t: postSample.t, k: postSample.values[0], c: postC };
    pre.k[pre.k.length - 1] = kMinus;
    pre.c[pre.c.length - 1] = cMinus;
    post.k[0] = kPlus;
    post.c[0] = cMinus;
    return {
      parameters: { kind: kind, tfpTiming: timing, T: T, eis: eis, A0: A0, A1: A1, capitalLoss: capitalLoss },
      steadyStates: { A0: ss0, A1: ss1 },
      policies: { A0: policy0.sample(), A1: policy1.sample() },
      pre: pre,
      post: post,
      event: { kMinus: kMinus, kPlus: kPlus, cMinus: cMinus, cPlus: cMinus },
      metrics: {
        k0: k0,
        cBaseline: ss0.c,
        c0: c0,
        announcementJump: c0 - ss0.c,
        matchingResidual: matchingResidual
      },
      diagnostics: {
        identity: false,
        method: solveMethod,
        rootIterations: root.iterations,
        evaluations: rootEvaluations + preRaw.evaluations + postRaw.evaluations,
        bracket: bracket,
        policyDefect: data.normalizedPolicy.diagnostics[eis.toFixed(2)].defect
      }
    };
  }

  return {
    solveExperiment: solveExperiment,
    steadyState: steadyState,
    policyFor: policyFor,
    rhs: rhs,
    integrateAdaptive: integrateAdaptive
  };
}));
