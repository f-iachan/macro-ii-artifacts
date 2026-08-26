"use strict";

importScripts("data.js", "solver.js");

self.onmessage = function (event) {
  var request = event.data;
  try {
    var result = self.RamseyAnnouncedSolver.solveExperiment(
      request.parameters,
      self.RAMSEY_ANNOUNCED_DATA
    );
    self.postMessage({ id: request.id, ok: true, result: result });
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      error: error && error.message ? error.message : String(error)
    });
  }
};
