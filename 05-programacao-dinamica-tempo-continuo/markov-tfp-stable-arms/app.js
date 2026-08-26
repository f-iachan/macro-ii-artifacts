(function () {
  "use strict";

  var DATA = window.MARKOV_TFP_DATA;
  var COLORS = ["#0072b2", "#d55e00"];
  var GREEN = "#009e73";
  var SVG_NS = "http://www.w3.org/2000/svg";
  var T_MAX = 120;
  var DT = 0.05;

  var ui = {
    phase: document.getElementById("phase-chart"),
    capitalLowDistribution: document.getElementById("capital-low-distribution"),
    capitalHighDistribution: document.getElementById("capital-high-distribution"),
    capitalTotalDistribution: document.getElementById("capital-total-distribution"),
    consumptionLowDistribution: document.getElementById("consumption-low-distribution"),
    consumptionHighDistribution: document.getElementById("consumption-high-distribution"),
    consumptionTotalDistribution: document.getElementById("consumption-total-distribution"),
    capitalLowFigure: document.getElementById("capital-low-figure"),
    capitalHighFigure: document.getElementById("capital-high-figure"),
    consumptionLowFigure: document.getElementById("consumption-low-figure"),
    consumptionHighFigure: document.getElementById("consumption-high-figure"),
    strip: document.getElementById("regime-strip"),
    play: document.getElementById("play"),
    restart: document.getElementById("restart"),
    nextJump: document.getElementById("next-jump"),
    timeSlider: document.getElementById("time-slider"),
    timeOutput: document.getElementById("time-output"),
    speed: document.getElementById("speed"),
    speedLabel: document.getElementById("speed-label"),
    newPath: document.getElementById("new-path"),
    presetLabel: document.getElementById("preset-label"),
    hazardLow: document.getElementById("hazard-low"),
    hazardHigh: document.getElementById("hazard-high"),
    stateReadout: document.getElementById("state-readout"),
    stateName: document.getElementById("state-name"),
    stateSubtitle: document.getElementById("state-subtitle"),
    metricK: document.getElementById("metric-k"),
    metricC: document.getElementById("metric-c"),
    metricDrift: document.getElementById("metric-drift"),
    metricNext: document.getElementById("metric-next"),
    mechanism: document.getElementById("mechanism"),
    nowChip: document.getElementById("now-chip"),
    toggleDeterministic: document.getElementById("toggle-deterministic"),
    distributionNote: document.getElementById("distribution-note"),
    capitalLowPercentile: document.getElementById("capital-low-percentile"),
    capitalHighPercentile: document.getElementById("capital-high-percentile"),
    capitalTotalPercentile: document.getElementById("capital-total-percentile"),
    consumptionLowPercentile: document.getElementById("consumption-low-percentile"),
    consumptionHighPercentile: document.getElementById("consumption-high-percentile"),
    consumptionTotalPercentile: document.getElementById("consumption-total-percentile")
  };

  var state = {
    preset: "base",
    seed: 1731,
    path: [],
    events: [],
    index: 0,
    playhead: 0,
    playing: false,
    speed: 1,
    showDeterministic: true,
    frame: null,
    lastFrame: null
  };

  function svgElement(tag, attributes, text) {
    var element = document.createElementNS(SVG_NS, tag);
    Object.keys(attributes || {}).forEach(function (key) {
      element.setAttribute(key, attributes[key]);
    });
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function format(value, digits) {
    return Number(value).toLocaleString("pt-BR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function interpolate(grid, values, x) {
    if (x <= grid[0]) return values[0];
    if (x >= grid[grid.length - 1]) return values[values.length - 1];
    var low = 0;
    var high = grid.length - 1;
    while (high - low > 1) {
      var middle = (low + high) >> 1;
      if (grid[middle] <= x) low = middle;
      else high = middle;
    }
    var weight = (x - grid[low]) / (grid[high] - grid[low]);
    return values[low] * (1 - weight) + values[high] * weight;
  }

  function makeRng(seed) {
    var value = seed >>> 0;
    return function () {
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      return (value >>> 0) / 4294967296;
    };
  }

  function policy(preset, regime, capital) {
    return interpolate(DATA.grid, preset.policy[regime], capital);
  }

  function drift(preset, regime, capital) {
    return interpolate(DATA.grid, preset.drift[regime], capital);
  }

  function sampleStationaryStart(preset, rng) {
    var distribution = preset.capitalDistribution;
    var entries = [];
    var total = 0;
    for (var regime = 0; regime < 2; regime += 1) {
      for (var i = 0; i < distribution.x.length; i += 1) {
        total += distribution.mass[regime][i];
        entries.push({ total: total, regime: regime, k: distribution.x[i] });
      }
    }
    var draw = rng() * total;
    for (var j = 0; j < entries.length; j += 1) {
      if (draw <= entries[j].total) return entries[j];
    }
    return entries[entries.length - 1];
  }

  function rk4Capital(preset, regime, capital, step) {
    var f = function (k) { return drift(preset, regime, k); };
    var k1 = f(capital);
    var k2 = f(capital + 0.5 * step * k1);
    var k3 = f(capital + 0.5 * step * k2);
    var k4 = f(capital + step * k3);
    return clamp(capital + step * (k1 + 2 * k2 + 2 * k3 + k4) / 6, DATA.meta.kMin, DATA.meta.kMax);
  }

  function generatePath() {
    var preset = DATA.presets[state.preset];
    var rng = makeRng(state.seed);
    var start = sampleStationaryStart(preset, rng);
    var regime = start.regime;
    var capital = start.k;
    var time = 0;
    var lambda = regime === 0 ? preset.lambdaLowHigh : preset.lambdaHighLow;
    var nextEvent = -Math.log(Math.max(1e-12, 1 - rng())) / lambda;
    var path = [];
    var events = [];
    var steps = Math.round(T_MAX / DT);

    for (var index = 0; index <= steps; index += 1) {
      while (time + 1e-9 >= nextEvent) {
        var beforeConsumption = policy(preset, regime, capital);
        var oldRegime = regime;
        regime = 1 - regime;
        var afterConsumption = policy(preset, regime, capital);
        events.push({
          index: path.length,
          t: time,
          k: capital,
          from: oldRegime,
          to: regime,
          cBefore: beforeConsumption,
          cAfter: afterConsumption
        });
        lambda = regime === 0 ? preset.lambdaLowHigh : preset.lambdaHighLow;
        nextEvent = time - Math.log(Math.max(1e-12, 1 - rng())) / lambda;
      }

      path.push({
        t: time,
        k: capital,
        c: policy(preset, regime, capital),
        drift: drift(preset, regime, capital),
        regime: regime,
        nextEvent: nextEvent
      });
      capital = rk4Capital(preset, regime, capital, DT);
      time += DT;
    }
    state.path = path;
    state.events = events;
    state.index = 0;
    state.playhead = 0;
    ui.timeSlider.max = path.length - 1;
    ui.timeSlider.value = 0;
  }

  function scalesFor(svg, width, height, margins, xDomain, yDomain) {
    return {
      x: function (value) {
        return margins.left + (value - xDomain[0]) / (xDomain[1] - xDomain[0]) * (width - margins.left - margins.right);
      },
      y: function (value) {
        return height - margins.bottom - (value - yDomain[0]) / (yDomain[1] - yDomain[0]) * (height - margins.top - margins.bottom);
      }
    };
  }

  function linePath(xValues, yValues, scales) {
    return xValues.map(function (x, i) {
      return (i === 0 ? "M" : "L") + scales.x(x).toFixed(2) + "," + scales.y(yValues[i]).toFixed(2);
    }).join(" ");
  }

  function renderAxes(svg, width, height, margins, scales, xTicks, yTicks, xLabel, yLabel) {
    var gridColor = css("--grid");
    var muted = css("--muted");
    xTicks.forEach(function (tick) {
      var x = scales.x(tick);
      svg.appendChild(svgElement("line", { x1: x, x2: x, y1: margins.top, y2: height - margins.bottom, stroke: gridColor }));
      svg.appendChild(svgElement("text", { x: x, y: height - margins.bottom + 20, fill: muted, "font-size": 11, "text-anchor": "middle" }, format(tick, 0)));
    });
    yTicks.forEach(function (tick) {
      var y = scales.y(tick);
      svg.appendChild(svgElement("line", { x1: margins.left, x2: width - margins.right, y1: y, y2: y, stroke: gridColor }));
      svg.appendChild(svgElement("text", { x: margins.left - 10, y: y + 4, fill: muted, "font-size": 11, "text-anchor": "end" }, format(tick, 1)));
    });
    svg.appendChild(svgElement("text", { x: (margins.left + width - margins.right) / 2, y: height - 6, fill: muted, "font-size": 12, "text-anchor": "middle" }, xLabel));
    svg.appendChild(svgElement("text", { x: 14, y: (margins.top + height - margins.bottom) / 2, fill: muted, "font-size": 12, "text-anchor": "middle", transform: "rotate(-90 14 " + ((margins.top + height - margins.bottom) / 2) + ")" }, yLabel));
  }

  function renderPhase() {
    var svg = ui.phase;
    var width = Math.max(640, Math.round(svg.getBoundingClientRect().width || 900));
    var height = Math.round(svg.getBoundingClientRect().height || 520);
    var margins = { top: 22, right: 28, bottom: 43, left: 56 };
    var yMax = 2.35;
    var scales = scalesFor(svg, width, height, margins, [DATA.meta.kMin, DATA.meta.kMax], [0.42, yMax]);
    var preset = DATA.presets[state.preset];
    var point = state.path[state.index];
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.innerHTML = "";

    renderAxes(svg, width, height, margins, scales, [1, 3, 5, 7, 9], [0.5, 1, 1.5, 2], "capital, k", "consumo, c");

    if (state.showDeterministic) {
      for (var regime = 0; regime < 2; regime += 1) {
        svg.appendChild(svgElement("path", {
          d: linePath(DATA.grid, DATA.deterministic[regime], scales),
          fill: "none",
          stroke: COLORS[regime],
          "stroke-width": 1.8,
          "stroke-dasharray": "6 7",
          opacity: 0.48
        }));
      }
    }

    for (var r = 0; r < 2; r += 1) {
      svg.appendChild(svgElement("path", {
        d: linePath(DATA.grid, preset.policy[r], scales),
        fill: "none",
        stroke: COLORS[r],
        "stroke-width": 3.2,
        "stroke-linecap": "round"
      }));
      var ss = DATA.steadyStates[r];
      svg.appendChild(svgElement("circle", {
        cx: scales.x(ss.k), cy: scales.y(ss.c), r: 5.5,
        fill: css("--surface"), stroke: COLORS[r], "stroke-width": 2
      }));
      svg.appendChild(svgElement("text", {
        x: scales.x(ss.k) + (r === 0 ? -8 : 8),
        y: scales.y(ss.c) - 11,
        fill: COLORS[r], "font-size": 10, "font-weight": 700,
        "text-anchor": r === 0 ? "end" : "start"
      }, r === 0 ? "k*L" : "k*H"));
    }

    var trailDuration = 18;
    var trailStart = Math.max(0, state.index - Math.round(trailDuration / DT));
    var trail = state.path.slice(trailStart, state.index + 1);
    if (trail.length > 1) {
      var points = trail.map(function (d) { return scales.x(d.k).toFixed(1) + "," + scales.y(d.c).toFixed(1); }).join(" ");
      svg.appendChild(svgElement("polyline", {
        points: points, fill: "none", stroke: GREEN, "stroke-width": 3,
        "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.9
      }));
    }
    state.events.forEach(function (event) {
      if (event.index >= trailStart && event.index <= state.index) {
        svg.appendChild(svgElement("line", {
          x1: scales.x(event.k), x2: scales.x(event.k),
          y1: scales.y(event.cBefore), y2: scales.y(event.cAfter),
          stroke: GREEN, "stroke-width": 3, "stroke-linecap": "round", opacity: 0.9
        }));
      }
    });

    var currentX = scales.x(point.k);
    var currentY = scales.y(point.c);
    svg.appendChild(svgElement("circle", { cx: currentX, cy: currentY, r: 11, fill: COLORS[point.regime], opacity: 0.14 }));
    svg.appendChild(svgElement("circle", { cx: currentX, cy: currentY, r: 5.5, fill: COLORS[point.regime], stroke: css("--surface"), "stroke-width": 2.5 }));
    var direction = point.drift >= 0 ? "→" : "←";
    svg.appendChild(svgElement("text", {
      x: currentX + 12, y: currentY - 12, fill: COLORS[point.regime],
      "font-size": 12, "font-weight": 750
    }, direction + " agora"));
  }

  function simpleAreaPath(x, values, scales) {
    var path = x.map(function (value, i) {
      return (i === 0 ? "M" : "L") + scales.x(value).toFixed(2) + "," + scales.y(values[i]).toFixed(2);
    });
    path.push("L" + scales.x(x[x.length - 1]).toFixed(2) + "," + scales.y(0).toFixed(2));
    path.push("L" + scales.x(x[0]).toFixed(2) + "," + scales.y(0).toFixed(2) + " Z");
    return path.join(" ");
  }

  function cumulativePercentile(xValues, mass, current) {
    var total = 0;
    var below = 0;
    xValues.forEach(function (x, i) {
      total += mass[i];
      if (x <= current) below += mass[i];
    });
    return total > 0 ? 100 * below / total : 0;
  }

  function renderDistribution(svg, xValues, mass, current, axisLabel, percentileElement, color, showMarker, sharedYMax) {
    var width = Math.max(300, Math.round(svg.getBoundingClientRect().width || 420));
    var height = Math.round(svg.getBoundingClientRect().height || 145);
    var margins = { top: 10, right: 14, bottom: 32, left: 18 };
    var yMax = sharedYMax || Math.max.apply(null, mass) * 1.12;
    var step = xValues[1] - xValues[0];
    var xDomain = [xValues[0] - step / 2, xValues[xValues.length - 1] + step / 2];
    var scales = scalesFor(svg, width, height, margins, xDomain, [0, yMax]);
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.innerHTML = "";

    [0.25, 0.5, 0.75].forEach(function (share) {
      var y = margins.top + share * (height - margins.top - margins.bottom);
      svg.appendChild(svgElement("line", { x1: margins.left, x2: width - margins.right, y1: y, y2: y, stroke: css("--grid") }));
    });
    svg.appendChild(svgElement("path", {
      d: simpleAreaPath(xValues, mass, scales),
      fill: color, opacity: 0.64
    }));
    svg.appendChild(svgElement("path", {
      d: linePath(xValues, mass, scales), fill: "none", stroke: color, "stroke-width": 1.6, opacity: 0.95
    }));

    var ticks = [xDomain[0], (xDomain[0] + xDomain[1]) / 2, xDomain[1]];
    ticks.forEach(function (tick) {
      svg.appendChild(svgElement("text", { x: scales.x(tick), y: height - 13, fill: css("--muted"), "font-size": 10, "text-anchor": "middle" }, format(tick, 1)));
    });
    svg.appendChild(svgElement("text", { x: width - margins.right, y: height - 2, fill: css("--muted"), "font-size": 10, "text-anchor": "end" }, axisLabel));

    if (showMarker) {
      var needleX = scales.x(clamp(current, xDomain[0], xDomain[1]));
      svg.appendChild(svgElement("line", { x1: needleX, x2: needleX, y1: margins.top, y2: height - margins.bottom, stroke: css("--ink"), "stroke-width": 2 }));
      svg.appendChild(svgElement("circle", { cx: needleX, cy: margins.top + 3, r: 3.5, fill: css("--ink") }));
      var percentile = cumulativePercentile(xValues, mass, current);
      percentileElement.textContent = "agora: percentil " + Math.round(percentile);
    } else {
      percentileElement.textContent = "condicional";
    }
  }

  function renderStrip() {
    var svg = ui.strip;
    var width = Math.max(180, Math.round(svg.getBoundingClientRect().width || 400));
    var height = 20;
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.innerHTML = "";
    var segments = [];
    var start = 0;
    var regime = state.path[0].regime;
    for (var i = 1; i < state.path.length; i += 1) {
      if (state.path[i].regime !== regime) {
        segments.push({ start: start, end: i, regime: regime });
        start = i;
        regime = state.path[i].regime;
      }
    }
    segments.push({ start: start, end: state.path.length - 1, regime: regime });
    segments.forEach(function (segment) {
      svg.appendChild(svgElement("rect", {
        x: segment.start / (state.path.length - 1) * width,
        y: 5,
        width: Math.max(1, (segment.end - segment.start) / (state.path.length - 1) * width),
        height: 10,
        fill: COLORS[segment.regime],
        opacity: 0.72
      }));
    });
    var cursor = state.index / (state.path.length - 1) * width;
    svg.appendChild(svgElement("line", { x1: cursor, x2: cursor, y1: 1, y2: 19, stroke: css("--ink"), "stroke-width": 2 }));
  }

  function updateReadout() {
    var point = state.path[state.index];
    var preset = DATA.presets[state.preset];
    var regimeName = point.regime === 0 ? "TFP baixa" : "TFP alta";
    var stateColor = COLORS[point.regime];
    document.documentElement.style.setProperty("--state-color", stateColor);
    ui.stateName.textContent = regimeName;
    ui.stateSubtitle.textContent = "A = " + format(DATA.meta.A[point.regime], 2) + " · na política " + (point.regime === 0 ? "azul" : "laranja");
    ui.metricK.textContent = format(point.k, 3);
    ui.metricC.textContent = format(point.c, 3);
    ui.metricDrift.textContent = (point.drift >= 0 ? "+" : "") + format(point.drift, 3);
    ui.metricDrift.style.color = point.drift >= 0 ? GREEN : COLORS[1];
    var upcomingEvent = state.events.find(function (event) { return event.index > state.index; });
    ui.metricNext.textContent = upcomingEvent ? format(upcomingEvent.t - point.t, 1) + " anos" : "fora da janela";
    ui.nextJump.disabled = !upcomingEvent;
    ui.nextJump.textContent = upcomingEvent ? "Próximo salto" : "Sem novos saltos";
    ui.nowChip.textContent = "t = " + format(point.t, 1) + " · " + regimeName;
    ui.timeOutput.textContent = format(point.t, 1) + " anos";
    ui.timeSlider.value = state.index;
    var previous = state.index > 0 ? state.path[state.index - 1] : point;
    if (previous.regime !== point.regime) {
      ui.mechanism.innerHTML = "<strong>Salto Markov não antecipado:</strong> k ficou contínuo; c mudou imediatamente para P<sub>" + (point.regime === 0 ? "L" : "H") + "</sub>(k).";
    } else {
      ui.mechanism.innerHTML = "<strong>Entre saltos:</strong> k " + (point.drift >= 0 ? "cresce" : "cai") + " continuamente enquanto c acompanha a política do regime " + (point.regime === 0 ? "baixo" : "alto") + ".";
    }
    ui.distributionNote.textContent = Math.round((1 - preset.stationaryHigh) * 100) + "% em TFP baixa · " + Math.round(preset.stationaryHigh * 100) + "% em TFP alta";
  }

  function renderAll() {
    updateReadout();
    renderPhase();
    var point = state.path[state.index];
    var preset = DATA.presets[state.preset];
    var capital = preset.capitalDistribution;
    var consumption = preset.consumptionDistribution;
    var capitalBinWidth = capital.x[1] - capital.x[0];
    var consumptionBinWidth = consumption.x[1] - consumption.x[0];
    var capitalShares = capital.mass.map(function (values) { return values.reduce(function (a, b) { return a + b; }, 0); });
    var consumptionShares = consumption.mass.map(function (values) { return values.reduce(function (a, b) { return a + b; }, 0); });
    var capitalConditional = capital.mass.map(function (values, regime) { return values.map(function (value) { return value / capitalShares[regime] / capitalBinWidth; }); });
    var consumptionConditional = consumption.mass.map(function (values, regime) { return values.map(function (value) { return value / consumptionShares[regime] / consumptionBinWidth; }); });
    var capitalTotal = capital.mass[0].map(function (value, i) { return (value + capital.mass[1][i]) / capitalBinWidth; });
    var consumptionTotal = consumption.mass[0].map(function (value, i) { return (value + consumption.mass[1][i]) / consumptionBinWidth; });
    var capitalYMax = 1.12 * Math.max.apply(null, capitalConditional[0].concat(capitalConditional[1], capitalTotal));
    var consumptionYMax = 1.12 * Math.max.apply(null, consumptionConditional[0].concat(consumptionConditional[1], consumptionTotal));
    renderDistribution(ui.capitalLowDistribution, capital.x, capitalConditional[0], point.k, "k", ui.capitalLowPercentile, COLORS[0], point.regime === 0, capitalYMax);
    renderDistribution(ui.capitalHighDistribution, capital.x, capitalConditional[1], point.k, "k", ui.capitalHighPercentile, COLORS[1], point.regime === 1, capitalYMax);
    renderDistribution(ui.capitalTotalDistribution, capital.x, capitalTotal, point.k, "k", ui.capitalTotalPercentile, GREEN, true, capitalYMax);
    renderDistribution(ui.consumptionLowDistribution, consumption.x, consumptionConditional[0], point.c, "c", ui.consumptionLowPercentile, COLORS[0], point.regime === 0, consumptionYMax);
    renderDistribution(ui.consumptionHighDistribution, consumption.x, consumptionConditional[1], point.c, "c", ui.consumptionHighPercentile, COLORS[1], point.regime === 1, consumptionYMax);
    renderDistribution(ui.consumptionTotalDistribution, consumption.x, consumptionTotal, point.c, "c", ui.consumptionTotalPercentile, GREEN, true, consumptionYMax);
    ui.capitalLowFigure.classList.toggle("active-conditional", point.regime === 0);
    ui.capitalHighFigure.classList.toggle("active-conditional", point.regime === 1);
    ui.consumptionLowFigure.classList.toggle("active-conditional", point.regime === 0);
    ui.consumptionHighFigure.classList.toggle("active-conditional", point.regime === 1);
    ui.capitalLowFigure.style.setProperty("--active-panel-color", COLORS[0]);
    ui.capitalHighFigure.style.setProperty("--active-panel-color", COLORS[1]);
    ui.consumptionLowFigure.style.setProperty("--active-panel-color", COLORS[0]);
    ui.consumptionHighFigure.style.setProperty("--active-panel-color", COLORS[1]);
    renderStrip();
  }

  function setPlaying(playing) {
    state.playing = playing;
    ui.play.textContent = playing ? "❚❚" : "▶";
    ui.play.setAttribute("aria-label", playing ? "Pausar simulação" : "Reproduzir simulação");
    if (playing) {
      state.lastFrame = null;
      state.frame = requestAnimationFrame(animate);
    } else if (state.frame) {
      cancelAnimationFrame(state.frame);
      state.frame = null;
    }
  }

  function animate(timestamp) {
    if (!state.playing) return;
    if (state.lastFrame === null) state.lastFrame = timestamp;
    var elapsed = Math.min(100, timestamp - state.lastFrame);
    state.lastFrame = timestamp;
    var stepsPerSecond = 24 * state.speed;
    state.playhead = Math.min(state.path.length - 1, state.playhead + elapsed / 1000 * stepsPerSecond);
    state.index = Math.floor(state.playhead);
    renderAll();
    if (state.index >= state.path.length - 1) setPlaying(false);
    else state.frame = requestAnimationFrame(animate);
  }

  function applyPreset(key) {
    state.preset = key;
    generatePath();
    var preset = DATA.presets[key];
    ui.presetLabel.textContent = preset.label;
    ui.hazardLow.textContent = "λ = " + format(preset.lambdaLowHigh, 2) + " · duração " + format(preset.meanLow, 1) + " a";
    ui.hazardHigh.textContent = "λ = " + format(preset.lambdaHighLow, 2) + " · duração " + format(preset.meanHigh, 1) + " a";
    document.querySelectorAll(".preset-button").forEach(function (button) {
      button.classList.toggle("active", button.dataset.preset === key);
      button.setAttribute("aria-pressed", button.dataset.preset === key ? "true" : "false");
    });
    setPlaying(false);
    renderAll();
  }

  ui.play.addEventListener("click", function () { setPlaying(!state.playing); });
  ui.restart.addEventListener("click", function () {
    setPlaying(false);
    state.index = 0;
    state.playhead = 0;
    renderAll();
  });
  ui.nextJump.addEventListener("click", function () {
    setPlaying(false);
    var target = state.events.find(function (event) { return event.index > state.index; });
    if (target) {
      state.index = Math.min(state.path.length - 1, target.index);
      state.playhead = state.index;
      renderAll();
    }
  });
  ui.timeSlider.addEventListener("input", function () {
    setPlaying(false);
    state.index = Number(ui.timeSlider.value);
    state.playhead = state.index;
    renderAll();
  });
  ui.speed.addEventListener("input", function () {
    state.speed = Number(ui.speed.value);
    ui.speedLabel.textContent = format(state.speed, state.speed % 1 ? 1 : 0) + "×";
  });
  ui.newPath.addEventListener("click", function () {
    setPlaying(false);
    state.seed += 997;
    generatePath();
    renderAll();
  });
  ui.toggleDeterministic.addEventListener("click", function () {
    state.showDeterministic = !state.showDeterministic;
    ui.toggleDeterministic.setAttribute("aria-pressed", state.showDeterministic ? "true" : "false");
    ui.toggleDeterministic.textContent = state.showDeterministic ? "Visíveis" : "Ocultas";
    renderPhase();
  });
  document.querySelectorAll(".preset-button").forEach(function (button) {
    button.addEventListener("click", function () { applyPreset(button.dataset.preset); });
  });
  document.addEventListener("keydown", function (event) {
    if (event.code === "Space" && event.target.tagName !== "BUTTON" && event.target.tagName !== "INPUT") {
      event.preventDefault();
      setPlaying(!state.playing);
    }
  });
  window.addEventListener("resize", function () { renderAll(); });

  applyPreset("base");
}());
