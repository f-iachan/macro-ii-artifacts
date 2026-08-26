(function () {
  "use strict";

  var DATA = window.RAMSEY_ANNOUNCED_DATA;
  var SOLVER = window.RamseyAnnouncedSolver;
  var SVG_NS = "http://www.w3.org/2000/svg";
  var POST_HORIZON = 38;
  var CACHE_LIMIT = 36;

  var ui = {
    experimentButtons: Array.prototype.slice.call(document.querySelectorAll(".experiment-button")),
    timingButtons: Array.prototype.slice.call(document.querySelectorAll(".timing-button")),
    timingRow: document.getElementById("tfp-timing-row"),
    fixedLoss: document.getElementById("fixed-loss"),
    a1Field: document.getElementById("a1-field"),
    eventTime: document.getElementById("event-time"),
    eventTimeOutput: document.getElementById("event-time-output"),
    eis: document.getElementById("eis"),
    eisOutput: document.getElementById("eis-output"),
    a0: document.getElementById("a0"),
    a0Output: document.getElementById("a0-output"),
    a1: document.getElementById("a1"),
    a1Output: document.getElementById("a1-output"),
    play: document.getElementById("play"),
    restart: document.getElementById("restart"),
    goEvent: document.getElementById("go-event"),
    timeSlider: document.getElementById("time-slider"),
    timeOutput: document.getElementById("time-output"),
    speed: document.getElementById("speed"),
    solverStatus: document.getElementById("solver-status"),
    statusMessage: document.getElementById("status-message"),
    errorMessage: document.getElementById("error-message"),
    phase: document.getElementById("phase-chart"),
    capital: document.getElementById("capital-chart"),
    consumption: document.getElementById("consumption-chart"),
    phaseSubtitle: document.getElementById("phase-subtitle"),
    phaseLegend: document.getElementById("phase-legend"),
    nowValue: document.getElementById("now-value"),
    nowRegime: document.getElementById("now-regime"),
    stateValue: document.getElementById("state-value"),
    motionValue: document.getElementById("motion-value"),
    matchingValue: document.getElementById("matching-value"),
    eventValue: document.getElementById("event-value"),
    announcementExplanation: document.getElementById("announcement-explanation"),
    announcementEquation: document.getElementById("announcement-equation"),
    eventExplanation: document.getElementById("event-explanation"),
    eventEquation: document.getElementById("event-equation")
  };

  var state = {
    kind: "tfp",
    timing: "starts",
    solution: null,
    time: 0,
    playing: false,
    speed: 1,
    frame: null,
    lastFrame: null,
    requestId: 0,
    pendingId: 0,
    worker: null,
    workerFailed: false,
    debounce: null,
    cache: new Map()
  };

  function format(value, digits) {
    return Number(value).toLocaleString("pt-BR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function svgElement(tag, attributes, text) {
    var element = document.createElementNS(SVG_NS, tag);
    Object.keys(attributes || {}).forEach(function (key) { element.setAttribute(key, attributes[key]); });
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function extent(values) {
    var low = Infinity;
    var high = -Infinity;
    values.forEach(function (value) {
      if (Number.isFinite(value)) {
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
    });
    return [low, high];
  }

  function paddedDomain(values, share, floor) {
    var limits = extent(values);
    var magnitude = Math.max(1, Math.abs(limits[0]), Math.abs(limits[1]));
    var span = Math.max(1e-6, limits[1] - limits[0], 0.08 * magnitude);
    var pad = span * share;
    return [Math.max(floor === undefined ? -Infinity : floor, limits[0] - pad), limits[1] + pad];
  }

  function makeScale(domain, range) {
    return function (value) {
      return range[0] + (value - domain[0]) / (domain[1] - domain[0]) * (range[1] - range[0]);
    };
  }

  function linePath(xValues, yValues, xScale, yScale) {
    var path = "";
    for (var i = 0; i < xValues.length; i += 1) {
      if (!Number.isFinite(xValues[i]) || !Number.isFinite(yValues[i])) continue;
      path += (path ? "L" : "M") + xScale(xValues[i]).toFixed(2) + "," + yScale(yValues[i]).toFixed(2);
    }
    return path;
  }

  function tickValues(domain, count) {
    var ticks = [];
    for (var i = 0; i < count; i += 1) ticks.push(domain[0] + i / (count - 1) * (domain[1] - domain[0]));
    return ticks;
  }

  function drawAxes(svg, width, height, margins, xDomain, yDomain, xLabel, yLabel, xSpecial) {
    var x = makeScale(xDomain, [margins.left, width - margins.right]);
    var y = makeScale(yDomain, [height - margins.bottom, margins.top]);
    var grid = css("--grid");
    var muted = css("--muted");
    var border = css("--border");
    var xTicks = xSpecial || tickValues(xDomain, width < 390 ? 3 : 4);
    var yTicks = tickValues(yDomain, 4);
    svg.appendChild(svgElement("rect", {
      x: margins.left, y: margins.top,
      width: width - margins.left - margins.right,
      height: height - margins.top - margins.bottom,
      fill: "none", stroke: border, "stroke-width": 1
    }));
    xTicks.forEach(function (value, index) {
      var xpos = x(value);
      svg.appendChild(svgElement("line", { x1: xpos, x2: xpos, y1: margins.top, y2: height - margins.bottom, stroke: grid }));
      svg.appendChild(svgElement("text", {
        x: xpos, y: height - margins.bottom + 19, fill: muted, "font-size": 11,
        "text-anchor": index === 0 ? "start" : (index === xTicks.length - 1 ? "end" : "middle")
      }, format(value, value < 10 ? 1 : 0)));
    });
    yTicks.forEach(function (value) {
      var ypos = y(value);
      svg.appendChild(svgElement("line", { x1: margins.left, x2: width - margins.right, y1: ypos, y2: ypos, stroke: grid }));
      svg.appendChild(svgElement("text", { x: margins.left - 9, y: ypos + 4, fill: muted, "font-size": 11, "text-anchor": "end" }, format(value, 2)));
    });
    svg.appendChild(svgElement("text", {
      x: (margins.left + width - margins.right) / 2, y: height - 4,
      fill: muted, "font-size": 12, "text-anchor": "middle", class: "axis-title", "data-axis": "x"
    }, xLabel));
    svg.appendChild(svgElement("text", {
      x: 15, y: (margins.top + height - margins.bottom) / 2,
      fill: muted, "font-size": 12, "text-anchor": "middle", class: "axis-title", "data-axis": "y",
      transform: "rotate(-90 15 " + ((margins.top + height - margins.bottom) / 2) + ")"
    }, yLabel));
    return { x: x, y: y };
  }

  function parameters() {
    return {
      kind: state.kind,
      tfpTiming: state.timing,
      T: Number(ui.eventTime.value),
      eis: Number(ui.eis.value),
      A0: Number(ui.a0.value),
      A1: Number(ui.a1.value),
      capitalLoss: DATA.ranges.capitalLoss
    };
  }

  function cacheKey(params) {
    return [params.kind, params.tfpTiming, params.T.toFixed(1), params.eis.toFixed(2), params.A0.toFixed(2), params.A1.toFixed(2)].join("|");
  }

  function updateOutputs() {
    ui.eventTimeOutput.textContent = format(ui.eventTime.value, 1) + " anos";
    ui.eisOutput.textContent = format(ui.eis.value, 2) + " · θ = " + format(1 / Number(ui.eis.value), 2);
    ui.a0Output.textContent = format(ui.a0.value, 2);
    ui.a1Output.textContent = format(ui.a1.value, 2);
    var destruction = state.kind === "destruction";
    ui.timingRow.classList.toggle("hidden", destruction);
    ui.a1Field.classList.toggle("hidden", destruction);
    ui.fixedLoss.classList.toggle("visible", destruction);
  }

  function setStatus(mode, message) {
    ui.solverStatus.classList.toggle("solving", mode === "solving");
    ui.solverStatus.classList.toggle("error", mode === "error");
    ui.statusMessage.textContent = message;
    ui.errorMessage.classList.toggle("hidden", mode !== "error");
    ui.errorMessage.textContent = mode === "error" ? message : "";
  }

  function setPlaying(value) {
    if (value && !state.solution) return;
    state.playing = value;
    ui.play.textContent = value ? "❚❚ Pausar" : "▶ Reproduzir";
    ui.play.setAttribute("aria-label", value ? "Pausar animação" : "Reproduzir animação");
    if (value) {
      if (state.time >= Number(ui.timeSlider.max) - 1e-8) state.time = 0;
      state.lastFrame = null;
      state.frame = requestAnimationFrame(animate);
    } else if (state.frame) {
      cancelAnimationFrame(state.frame);
      state.frame = null;
    }
  }

  function setupWorker() {
    if (!("Worker" in window)) return;
    try {
      state.worker = new Worker("solver-worker.js");
      state.worker.onmessage = function (event) {
        var response = event.data;
        if (response.id !== state.pendingId) return;
        if (response.ok) acceptSolution(response.result);
        else handleSolveError(response.error);
      };
      state.worker.onerror = function () {
        if (state.worker) state.worker.terminate();
        state.worker = null;
        state.workerFailed = true;
        solveSynchronously(parameters(), state.pendingId);
      };
    } catch (error) {
      state.worker = null;
      state.workerFailed = true;
    }
  }

  function solveSynchronously(params, requestId) {
    window.setTimeout(function () {
      if (requestId !== state.pendingId) return;
      try {
        var result = SOLVER.solveExperiment(params, DATA);
        if (requestId === state.pendingId) acceptSolution(result);
      } catch (error) {
        if (requestId === state.pendingId) handleSolveError(error.message || String(error));
      }
    }, 0);
  }

  function requestSolve() {
    updateOutputs();
    setPlaying(false);
    state.requestId += 1;
    state.pendingId = state.requestId;
    var params = parameters();
    var key = cacheKey(params);
    if (state.cache.has(key)) {
      acceptSolution(state.cache.get(key), false);
      return;
    }
    setStatus("solving", "Calculando a trajetória que satisfaz o matching em T…");
    if (state.worker) state.worker.postMessage({ id: state.pendingId, parameters: params });
    else solveSynchronously(params, state.pendingId);
  }

  function scheduleSolve() {
    updateOutputs();
    setPlaying(false);
    state.requestId += 1;
    state.pendingId = state.requestId;
    setStatus("solving", "Atualizando a trajetória para os novos parâmetros…");
    clearTimeout(state.debounce);
    state.debounce = setTimeout(requestSolve, 120);
  }

  function acceptSolution(solution, addToCache) {
    state.solution = solution;
    state.time = 0;
    ui.timeSlider.min = 0;
    ui.timeSlider.max = solution.parameters.T + POST_HORIZON;
    ui.timeSlider.value = 0;
    ui.play.disabled = false;
    if (addToCache !== false) {
      var key = cacheKey(solution.parameters);
      state.cache.set(key, solution);
      if (state.cache.size > CACHE_LIMIT) state.cache.delete(state.cache.keys().next().value);
    }
    setStatus("ready", "Trajetória selecionada · |resíduo do matching| = " + Math.abs(solution.metrics.matchingResidual).toExponential(1));
    updateExplanations();
    renderAll();
  }

  function handleSolveError(message) {
    setPlaying(false);
    setStatus("error", "Não foi possível resolver esta combinação: " + message + " A última trajetória válida foi preservada.");
  }

  function interpolateSeries(segment, key, time) {
    if (time <= segment.t[0]) return segment[key][0];
    if (time >= segment.t[segment.t.length - 1]) return segment[key][segment[key].length - 1];
    var lo = 0;
    var hi = segment.t.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (segment.t[mid] <= time) lo = mid;
      else hi = mid;
    }
    var weight = (time - segment.t[lo]) / (segment.t[hi] - segment.t[lo]);
    return segment[key][lo] * (1 - weight) + segment[key][hi] * weight;
  }

  function currentPoint() {
    var solution = state.solution;
    var segment = state.time < solution.parameters.T ? solution.pre : solution.post;
    return {
      t: state.time,
      k: interpolateSeries(segment, "k", state.time),
      c: interpolateSeries(segment, "c", state.time)
    };
  }

  function activeA() {
    var p = state.solution.parameters;
    if (p.kind === "destruction") return p.A0;
    if (p.tfpTiming === "starts") return state.time < p.T ? p.A0 : p.A1;
    return state.time < p.T ? p.A1 : p.A0;
  }

  function sliced(segment, until) {
    var end = 0;
    while (end < segment.t.length && segment.t[end] <= until + 1e-10) end += 1;
    return {
      t: segment.t.slice(0, end),
      k: segment.k.slice(0, end),
      c: segment.c.slice(0, end)
    };
  }

  function addPath(svg, d, stroke, width, opacity, dash) {
    if (!d) return;
    var attributes = { d: d, fill: "none", stroke: stroke, "stroke-width": width, opacity: opacity, "stroke-linecap": "round", "stroke-linejoin": "round" };
    if (dash) attributes["stroke-dasharray"] = dash;
    svg.appendChild(svgElement("path", attributes));
  }

  function renderVectorField(svg, scales, domains, regimeA, eis) {
    var color = Math.abs(regimeA - state.solution.parameters.A0) < 1e-8 ? css("--blue") : css("--orange");
    for (var ix = 1; ix < 7; ix += 1) {
      for (var iy = 1; iy < 6; iy += 1) {
        var k = domains.x[0] + ix / 7 * (domains.x[1] - domains.x[0]);
        var c = domains.y[0] + iy / 6 * (domains.y[1] - domains.y[0]);
        var vector = SOLVER.rhs(regimeA, eis, k, c, DATA);
        if (!Number.isFinite(vector[0]) || !Number.isFinite(vector[1])) continue;
        var dx = scales.x(k + vector[0] * 0.4) - scales.x(k);
        var dy = scales.y(c + vector[1] * 0.4) - scales.y(c);
        var length = Math.sqrt(dx * dx + dy * dy);
        if (length < 1e-8) continue;
        var target = 9;
        dx *= target / length;
        dy *= target / length;
        svg.appendChild(svgElement("line", {
          x1: scales.x(k) - dx / 2, y1: scales.y(c) - dy / 2,
          x2: scales.x(k) + dx / 2, y2: scales.y(c) + dy / 2,
          stroke: color, "stroke-width": 1.1, opacity: 0.28, "stroke-linecap": "round"
        }));
        svg.appendChild(svgElement("circle", { cx: scales.x(k) + dx / 2, cy: scales.y(c) + dy / 2, r: 1.35, fill: color, opacity: 0.42 }));
      }
    }
  }

  function renderPhase() {
    var solution = state.solution;
    var p = solution.parameters;
    var svg = ui.phase;
    var identity = p.kind === "tfp" && Math.abs(p.A0 - p.A1) < 1e-12;
    var measuredWidth = Math.round(svg.getBoundingClientRect().width);
    var width = measuredWidth > 0 ? measuredWidth : 560;
    var height = Math.max(280, Math.round(svg.getBoundingClientRect().height || 390));
    var margins = { top: 19, right: 20, bottom: 42, left: 62 };
    var kValues = solution.pre.k.concat(solution.post.k, [solution.steadyStates.A0.k]);
    if (p.kind === "tfp") kValues.push(solution.steadyStates.A1.k);
    if (p.kind === "destruction") kValues.push(solution.event.kMinus, solution.event.kPlus);
    var xDomain = paddedDomain(kValues, 0.22, 0.05);
    var policyValues = [];
    [solution.policies.A0, solution.policies.A1].forEach(function (policy) {
      policy.k.forEach(function (k, i) { if (k >= xDomain[0] && k <= xDomain[1]) policyValues.push(policy.c[i]); });
    });
    var yDomain = paddedDomain(solution.pre.c.concat(solution.post.c, policyValues, [solution.metrics.cBaseline]), 0.16, 0.04);
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    while (svg.lastChild && !["title", "desc"].includes(svg.lastChild.tagName)) svg.removeChild(svg.lastChild);
    var scales = drawAxes(svg, width, height, margins, xDomain, yDomain, "capital, k", "consumo, c");
    renderVectorField(svg, scales, { x: xDomain, y: yDomain }, activeA(), p.eis);

    var filteredPolicyPath = function (policy) {
      var xs = [];
      var ys = [];
      policy.k.forEach(function (k, i) {
        if (k >= xDomain[0] && k <= xDomain[1]) { xs.push(k); ys.push(policy.c[i]); }
      });
      return linePath(xs, ys, scales.x, scales.y);
    };
    addPath(svg, filteredPolicyPath(solution.policies.A0), css("--blue"), 2.2, 0.9);
    if (p.kind === "tfp" && !identity) addPath(svg, filteredPolicyPath(solution.policies.A1), css("--orange"), 2.2, 0.9);
    if (p.kind === "destruction") {
      var shiftedK = [];
      var shiftedC = [];
      solution.policies.A0.k.forEach(function (k, i) {
        var preK = k + p.capitalLoss;
        if (preK >= xDomain[0] && preK <= xDomain[1]) { shiftedK.push(preK); shiftedC.push(solution.policies.A0.c[i]); }
      });
      addPath(svg, linePath(shiftedK, shiftedC, scales.x, scales.y), css("--orange"), 1.8, 0.7, "6 6");
    }

    addPath(svg, linePath(solution.pre.k, solution.pre.c, scales.x, scales.y), css("--ink"), 2, 0.2);
    addPath(svg, linePath(solution.post.k, solution.post.c, scales.x, scales.y), css("--magenta"), 2, 0.2);
    if (state.time < p.T) {
      var elapsedPre = sliced(solution.pre, state.time);
      addPath(svg, linePath(elapsedPre.k, elapsedPre.c, scales.x, scales.y), css("--ink"), 3, 0.95);
    } else {
      addPath(svg, linePath(solution.pre.k, solution.pre.c, scales.x, scales.y), css("--ink"), 3, 0.95);
      var elapsedPost = sliced(solution.post, state.time);
      addPath(svg, linePath(elapsedPost.k, elapsedPost.c, scales.x, scales.y), css("--magenta"), 3, 0.95);
    }

    if (Math.abs(solution.metrics.announcementJump) > 1e-8) {
      svg.appendChild(svgElement("line", {
        x1: scales.x(solution.metrics.k0), x2: scales.x(solution.metrics.k0),
        y1: scales.y(solution.metrics.cBaseline), y2: scales.y(solution.metrics.c0),
        stroke: css("--green"), "stroke-width": 2.4, "stroke-dasharray": "4 4", opacity: 0.85
      }));
      svg.appendChild(svgElement("circle", { cx: scales.x(solution.metrics.k0), cy: scales.y(solution.metrics.cBaseline), r: 4, fill: css("--surface"), stroke: css("--green"), "stroke-width": 1.5 }));
    }
    if (p.kind === "destruction") {
      svg.appendChild(svgElement("line", {
        x1: scales.x(solution.event.kMinus), x2: scales.x(solution.event.kPlus),
        y1: scales.y(solution.event.cMinus), y2: scales.y(solution.event.cPlus),
        stroke: css("--red"), "stroke-width": 3, opacity: state.time >= p.T ? 0.95 : 0.28
      }));
    }
    [[solution.steadyStates.A0, css("--blue")]].concat(p.kind === "tfp" && !identity ? [[solution.steadyStates.A1, css("--orange")]] : []).forEach(function (entry) {
      svg.appendChild(svgElement("circle", { cx: scales.x(entry[0].k), cy: scales.y(entry[0].c), r: 5, fill: css("--surface"), stroke: entry[1], "stroke-width": 2 }));
    });
    var point = currentPoint();
    svg.appendChild(svgElement("circle", { cx: scales.x(point.k), cy: scales.y(point.c), r: 10, fill: css("--green"), opacity: 0.18 }));
    svg.appendChild(svgElement("circle", { cx: scales.x(point.k), cy: scales.y(point.c), r: 5, fill: css("--green"), stroke: css("--surface"), "stroke-width": 2 }));

    var activeLabel = Math.abs(activeA() - p.A0) < 1e-8 ? "A₀" : "A₁";
    ui.phaseSubtitle.textContent = "campo " + activeLabel + " ativo em t = " + format(state.time, 2);
    var legend = [
      '<span><i style="--legend-color:var(--blue)"></i>P₀(k)</span>'
    ];
    if (identity) legend[0] = '<span><i style="--legend-color:var(--blue)"></i>P₀(k) = P₁(k)</span>';
    else if (p.kind === "tfp") legend.push('<span><i style="--legend-color:var(--orange)"></i>P₁(k)</span>');
    else legend.push('<span><i style="--legend-color:var(--orange)"></i>alvo antes do desastre</span>');
    legend.push('<span><i style="--legend-color:var(--ink)"></i>antes de T</span>');
    legend.push('<span><i style="--legend-color:var(--magenta)"></i>depois de T</span>');
    ui.phaseLegend.innerHTML = legend.join("");
  }

  function timeTicks(T, total) {
    var raw = [0, T, total];
    if (T > 5 && total - T > 10) raw.splice(1, 0, T / 2);
    return raw.filter(function (value, index, values) { return index === 0 || Math.abs(value - values[index - 1]) > 0.5; });
  }

  function renderTimeChart(svg, key, label, color) {
    var solution = state.solution;
    var p = solution.parameters;
    var measuredWidth = Math.round(svg.getBoundingClientRect().width);
    var width = measuredWidth > 0 ? measuredWidth : 410;
    var height = Math.max(260, Math.round(svg.getBoundingClientRect().height || 390));
    var margins = { top: 18, right: 18, bottom: 42, left: 62 };
    var total = p.T + POST_HORIZON;
    var baseline = key === "k" ? solution.metrics.k0 : solution.metrics.cBaseline;
    var yDomain = paddedDomain(solution.pre[key].concat(solution.post[key], [baseline]), 0.16, 0.02);
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    while (svg.lastChild && !["title", "desc"].includes(svg.lastChild.tagName)) svg.removeChild(svg.lastChild);
    var scales = drawAxes(svg, width, height, margins, [0, total], yDomain, "tempo, anos", label, timeTicks(p.T, total));
    svg.appendChild(svgElement("line", {
      x1: scales.x(p.T), x2: scales.x(p.T), y1: margins.top, y2: height - margins.bottom,
      stroke: css("--red"), "stroke-width": 1.6, "stroke-dasharray": "5 5", opacity: 0.75
    }));
    svg.appendChild(svgElement("text", { x: scales.x(p.T), y: margins.top + 12, fill: css("--red"), "font-size": 11, "text-anchor": "middle" }, "T"));
    svg.appendChild(svgElement("line", {
      x1: scales.x(0), x2: scales.x(total), y1: scales.y(baseline), y2: scales.y(baseline),
      stroke: color, "stroke-width": 1, "stroke-dasharray": "2 5", opacity: 0.35
    }));
    addPath(svg, linePath(solution.pre.t, solution.pre[key], scales.x, scales.y), color, 2.1, 0.25);
    addPath(svg, linePath(solution.post.t, solution.post[key], scales.x, scales.y), color, 2.1, 0.25);
    if (key === "c" && Math.abs(solution.metrics.announcementJump) > 1e-8) {
      svg.appendChild(svgElement("line", {
        x1: scales.x(0), x2: scales.x(0), y1: scales.y(solution.metrics.cBaseline), y2: scales.y(solution.metrics.c0),
        stroke: css("--green"), "stroke-width": 3
      }));
    }
    if (key === "k" && p.kind === "destruction") {
      svg.appendChild(svgElement("line", {
        x1: scales.x(p.T), x2: scales.x(p.T), y1: scales.y(solution.event.kMinus), y2: scales.y(solution.event.kPlus),
        stroke: css("--red"), "stroke-width": 3, opacity: state.time >= p.T ? 0.95 : 0.3
      }));
    }
    if (state.time < p.T) {
      var elapsedPre = sliced(solution.pre, state.time);
      addPath(svg, linePath(elapsedPre.t, elapsedPre[key], scales.x, scales.y), color, 3, 0.98);
    } else {
      addPath(svg, linePath(solution.pre.t, solution.pre[key], scales.x, scales.y), color, 3, 0.98);
      var elapsedPost = sliced(solution.post, state.time);
      addPath(svg, linePath(elapsedPost.t, elapsedPost[key], scales.x, scales.y), color, 3, 0.98);
    }
    var point = currentPoint();
    var currentValue = key === "k" ? point.k : point.c;
    svg.appendChild(svgElement("line", {
      x1: scales.x(state.time), x2: scales.x(state.time), y1: margins.top, y2: height - margins.bottom,
      stroke: css("--ink"), "stroke-width": 1, opacity: 0.32
    }));
    svg.appendChild(svgElement("circle", { cx: scales.x(state.time), cy: scales.y(currentValue), r: 5, fill: color, stroke: css("--surface"), "stroke-width": 2 }));
  }

  function updateReadout() {
    var solution = state.solution;
    var p = solution.parameters;
    var point = currentPoint();
    var regimeA = activeA();
    var vector = SOLVER.rhs(regimeA, p.eis, point.k, point.c, DATA);
    ui.timeOutput.textContent = "t = " + format(state.time, 2);
    ui.timeSlider.value = state.time;
    ui.nowValue.textContent = "t = " + format(state.time, 2);
    if (state.time < 1e-8) ui.nowRegime.textContent = "logo após o anúncio";
    else if (state.time < p.T - 1e-8) ui.nowRegime.textContent = "antes de T · campo A = " + format(regimeA, 2);
    else if (Math.abs(state.time - p.T) < 0.06) ui.nowRegime.textContent = p.kind === "destruction" ? "destruição em T" : "troca de regime em T";
    else ui.nowRegime.textContent = "depois de T · campo A = " + format(regimeA, 2);
    ui.stateValue.textContent = "k = " + format(point.k, 3) + " · c = " + format(point.c, 3);
    ui.motionValue.textContent = "k̇ = " + (vector[0] >= 0 ? "+" : "") + format(vector[0], 3) + " · ċ = " + (vector[1] >= 0 ? "+" : "") + format(vector[1], 3);
    ui.matchingValue.textContent = "|resíduo| = " + Math.abs(solution.metrics.matchingResidual).toExponential(1);
    if (p.kind === "tfp" && Math.abs(p.A0 - p.A1) < 1e-12) {
      ui.eventValue.textContent = "sem mudança · k e c constantes em T";
    } else if (p.kind === "destruction") {
      ui.eventValue.textContent = "k: " + format(solution.event.kMinus, 3) + " → " + format(solution.event.kPlus, 3) + " · c contínuo";
    } else {
      ui.eventValue.textContent = "k(T) = " + format(solution.event.kMinus, 3) + " · c(T) = " + format(solution.event.cMinus, 3);
    }
  }

  function updateExplanations() {
    var solution = state.solution;
    var p = solution.parameters;
    var jump = solution.metrics.announcementJump;
    var direction = jump > 1e-7 ? "sobe" : (jump < -1e-7 ? "cai" : "não muda");
    if (p.kind === "tfp" && Math.abs(p.A0 - p.A1) < 1e-12) {
      ui.announcementExplanation.textContent = "Como A₀ = A₁, não há notícia econômica: consumo, capital e campo permanecem exatamente no estado estacionário.";
      ui.announcementEquation.innerHTML = "A₀=A₁, &nbsp; Δc(0)=0, &nbsp; k(0)=k*(A₀)";
      ui.eventExplanation.textContent = "A data T não altera tecnologia nem variáveis. Este é o benchmark exato de ausência de mudança.";
      ui.eventEquation.innerHTML = "k(T⁺)=k(T⁻), &nbsp; c(T⁺)=c(T⁻)";
    } else if (p.kind === "destruction") {
      ui.announcementExplanation.textContent = "Ao saber da perda futura, o consumo " + direction + " imediatamente e a economia começa a formar uma reserva de capital.";
      ui.announcementEquation.innerHTML = "k(0⁺)=k(0⁻), &nbsp; Δc(0)=" + (jump >= 0 ? "+" : "") + format(jump, 3);
      ui.eventExplanation.textContent = "O evento físico retira 0,50 unidade de capital. Como J′(k)=1, o consumo permanece contínuo neste exemplo aditivo.";
      ui.eventEquation.innerHTML = "k(T⁺)=k(T⁻)−0,50, &nbsp; c(T⁺)=c(T⁻)";
    } else if (p.tfpTiming === "ends") {
      var adjective = p.A1 > p.A0 ? "alta" : (p.A1 < p.A0 ? "baixa" : "igual");
      ui.announcementExplanation.textContent = "A TFP alternativa começa agora, " + adjective + " em relação a A₀. O campo e o consumo mudam; o capital permanece predeterminado.";
      ui.announcementEquation.innerHTML = "A(0⁺)=A₁, &nbsp; k(0⁺)=k*(A₀), &nbsp; Δc(0)=" + (jump >= 0 ? "+" : "") + format(jump, 3);
      ui.eventExplanation.textContent = "Em T, a TFP retorna a A₀. Capital e consumo são contínuos; a trajetória aterrissa em P₀(k).";
      ui.eventEquation.innerHTML = "c(T)=P₀(k(T)), &nbsp; k(T⁺)=k(T⁻)";
    } else {
      ui.announcementExplanation.textContent = "A tecnologia ainda é A₀, mas, com a notícia sobre A₁, o consumo " + direction + " hoje. O campo corrente e o capital não mudam.";
      ui.announcementEquation.innerHTML = "A(0⁺)=A₀, &nbsp; k(0⁺)=k*(A₀), &nbsp; Δc(0)=" + (jump >= 0 ? "+" : "") + format(jump, 3);
      ui.eventExplanation.textContent = "Em T, a tecnologia passa a A₁. O ponto é contínuo e já está sobre a variedade estável P₁(k).";
      ui.eventEquation.innerHTML = "c(T)=P₁(k(T)), &nbsp; k(T⁺)=k(T⁻)";
    }
  }

  function renderAll() {
    if (!state.solution) return;
    renderPhase();
    renderTimeChart(ui.capital, "k", "capital, k", css("--blue"));
    renderTimeChart(ui.consumption, "c", "consumo, c", css("--orange"));
    updateReadout();
  }

  function animate(timestamp) {
    if (!state.playing || !state.solution) return;
    if (state.lastFrame === null) state.lastFrame = timestamp;
    var elapsed = Math.min(100, timestamp - state.lastFrame);
    state.lastFrame = timestamp;
    state.time = Math.min(Number(ui.timeSlider.max), state.time + elapsed / 1000 * 3 * state.speed);
    renderAll();
    if (state.time >= Number(ui.timeSlider.max) - 1e-8) setPlaying(false);
    else state.frame = requestAnimationFrame(animate);
  }

  ui.experimentButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      state.kind = button.dataset.kind;
      ui.experimentButtons.forEach(function (item) { item.setAttribute("aria-pressed", item === button ? "true" : "false"); });
      requestSolve();
    });
  });
  ui.timingButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      state.timing = button.dataset.timing;
      ui.timingButtons.forEach(function (item) { item.setAttribute("aria-pressed", item === button ? "true" : "false"); });
      requestSolve();
    });
  });
  [ui.eventTime, ui.eis, ui.a0, ui.a1].forEach(function (input) { input.addEventListener("input", scheduleSolve); });
  ui.play.addEventListener("click", function () { setPlaying(!state.playing); });
  ui.restart.addEventListener("click", function () { setPlaying(false); state.time = 0; renderAll(); });
  ui.goEvent.addEventListener("click", function () { setPlaying(false); if (state.solution) { state.time = state.solution.parameters.T; renderAll(); } });
  ui.timeSlider.addEventListener("input", function () { setPlaying(false); state.time = Number(ui.timeSlider.value); renderAll(); });
  ui.speed.addEventListener("change", function () { state.speed = Number(ui.speed.value); });
  document.addEventListener("keydown", function (event) {
    if (event.code === "Space" && event.target.tagName !== "BUTTON" && event.target.tagName !== "INPUT" && event.target.tagName !== "SELECT") {
      event.preventDefault();
      setPlaying(!state.playing);
    }
  });
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderAll, 90);
  });

  setupWorker();
  updateOutputs();
  requestSolve();
}());
