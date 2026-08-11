(function () {
  "use strict";

  const baseline = {
    alpha: 0.33,
    beta: 0.99,
    rho: 0.95,
    sigma: 2,
    zeta: 2,
    delta: 0.025
  };

  const controls = {
    rho: document.getElementById("rho"),
    sigma: document.getElementById("sigma"),
    zeta: document.getElementById("zeta"),
    delta: document.getElementById("delta")
  };
  const values = Object.fromEntries(
    Object.keys(controls).map((key) => [key, document.getElementById(`${key}-value`)])
  );
  const canvas = document.getElementById("irf-chart");
  const status = document.getElementById("solver-status");
  const coefficientBody = document.getElementById("coefficient-body");
  const impact = document.getElementById("impact-values");
  const peak = document.getElementById("capital-peak");
  const persistence = document.getElementById("capital-persistence");
  const reset = document.getElementById("reset");

  let previousGuess = [0, 0];
  let latestSeries = null;
  let latestParameters = baseline;
  let scheduled = false;

  const plotted = [
    ["Produto", "output", "#0072B2", []],
    ["Consumo", "consumption", "#009E73", []],
    ["Investimento", "investment", "#D55E00", []],
    ["Trabalho", "labor", "#CC79A7", []],
    ["Capital", "capital", "#5F6368", [7, 5]],
    ["TFP", "productivity", "#56B4E9", [2, 5]]
  ];

  function readParameters() {
    return {
      alpha: baseline.alpha,
      beta: baseline.beta,
      rho: Number(controls.rho.value),
      sigma: Number(controls.sigma.value),
      zeta: Number(controls.zeta.value),
      delta: Number(controls.delta.value)
    };
  }

  function formatParameter(key, value) {
    if (key === "delta") return value.toFixed(3);
    if (key === "rho") return value.toFixed(2);
    return value.toFixed(1);
  }

  function updateLabels(parameters) {
    Object.keys(controls).forEach((key) => {
      values[key].textContent = formatParameter(key, parameters[key]);
    });
  }

  function coefficientRow(label, psiK, psiZ) {
    return `<tr><th scope="row">${label}</th><td>${psiK.toFixed(4)}</td><td>${psiZ.toFixed(4)}</td></tr>`;
  }

  function updateTable(c) {
    coefficientBody.innerHTML = [
      coefficientRow("Produto", c.psiYK, c.psiYz),
      coefficientRow("Consumo", c.psiCK, c.psiCz),
      coefficientRow("Investimento", c.psiIK, c.psiIz),
      coefficientRow("Trabalho", c.psiLK, c.psiLz)
    ].join("");
  }

  function cssColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function drawChart(series) {
    if (!series) return;
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(320, bounds.width);
    const height = Math.max(340, bounds.height);
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width, height);

    const margin = { left: 60, right: 22, top: 22, bottom: 48 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const all = plotted.flatMap(([, key]) => series[key]);
    let yMin = Math.min(0, ...all);
    let yMax = Math.max(0, ...all);
    const span = Math.max(0.2, yMax - yMin);
    yMin -= span * 0.08;
    yMax += span * 0.08;
    const x = (t) => margin.left + (t / (series.output.length - 1)) * plotWidth;
    const y = (value) => margin.top + ((yMax - value) / (yMax - yMin)) * plotHeight;

    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = cssColor("--muted-text");
    ctx.strokeStyle = cssColor("--grid");
    ctx.lineWidth = 1;
    for (let tick = 0; tick <= 4; tick += 1) {
      const value = yMin + (tick / 4) * (yMax - yMin);
      const yy = y(value);
      ctx.beginPath();
      ctx.moveTo(margin.left, yy);
      ctx.lineTo(width - margin.right, yy);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(value.toFixed(1), margin.left - 9, yy + 4);
    }
    [0, 10, 20, 30, 40, 50, 59].forEach((tick) => {
      const xx = x(tick);
      ctx.textAlign = "center";
      ctx.fillText(String(tick), xx, height - margin.bottom + 23);
    });
    ctx.fillText("trimestres", margin.left + plotWidth / 2, height - 8);
    ctx.save();
    ctx.translate(15, margin.top + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("% desvio do estado estacionário", 0, 0);
    ctx.restore();

    if (yMin < 0 && yMax > 0) {
      ctx.strokeStyle = cssColor("--axis");
      ctx.beginPath();
      ctx.moveTo(margin.left, y(0));
      ctx.lineTo(width - margin.right, y(0));
      ctx.stroke();
    }

    plotted.forEach(([, key, color, dash]) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      ctx.setLineDash(dash);
      ctx.beginPath();
      series[key].forEach((value, t) => {
        if (t === 0) ctx.moveTo(x(t), y(value));
        else ctx.lineTo(x(t), y(value));
      });
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  function render() {
    scheduled = false;
    const parameters = readParameters();
    updateLabels(parameters);
    let result = RBCSolver.solve(parameters, previousGuess);
    if (!result.ok) result = RBCSolver.solve(parameters, [0, 0]);
    latestParameters = parameters;

    if (!result.ok || !(result.coefficients.lambda > -1 && result.coefficients.lambda < 1)) {
      status.className = "solver-status error";
      status.textContent = `Sem solução estável nesta calibração; resíduo ${result.residual.toExponential(2)}.`;
      return;
    }

    previousGuess = [result.coefficients.psiLK, result.coefficients.psiLz];
    latestSeries = RBCSolver.impulseResponse(parameters, result.coefficients);
    status.className = "solver-status ok";
    status.textContent = `Newton convergiu em ${result.iterations} iteração(ões); resíduo máximo ${result.residual.toExponential(2)}.`;
    updateTable(result.coefficients);
    impact.textContent = `Impacto: Ŷ ${latestSeries.output[0].toFixed(2)} · Ĉ ${latestSeries.consumption[0].toFixed(2)} · Î ${latestSeries.investment[0].toFixed(2)} · L̂ ${latestSeries.labor[0].toFixed(2)}`;
    const peakValue = Math.max(...latestSeries.capital);
    const peakQuarter = latestSeries.capital.indexOf(peakValue);
    peak.textContent = `Pico de K̂: ${peakValue.toFixed(2)} no trimestre ${peakQuarter}`;
    persistence.textContent = `Autovalor do capital Λ: ${result.coefficients.lambda.toFixed(4)}`;
    drawChart(latestSeries);
  }

  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(render);
  }

  Object.values(controls).forEach((control) => {
    control.addEventListener("input", scheduleRender);
  });
  reset.addEventListener("click", () => {
    Object.entries(baseline).forEach(([key, value]) => {
      if (controls[key]) controls[key].value = String(value);
    });
    previousGuess = [0, 0];
    render();
  });
  new ResizeObserver(() => drawChart(latestSeries)).observe(canvas);

  render();
})();
