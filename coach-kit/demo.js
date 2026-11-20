/* Coach Kit page demo: the same rules as the Excel workbook (sheets "1RM calculator" and "Plan builder").
   Epley: kg x (1 + reps/30), Brzycki: kg x 36 / (37 - reps). Only 1-10 reps, otherwise no result.
   Target kg = % of the Epley estimate, rounded to 2.5 kg (Excel MROUND). Pure functions, tested in tests/coach-kit.test.mjs. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CoachKitDemo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var PERCENT = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95];
  function round1(x) { return Math.round((x + Number.EPSILON) * 10) / 10; }
  function valid(kg, reps) {
    return typeof kg === 'number' && isFinite(kg) && kg > 0 && kg <= 1000 &&
      typeof reps === 'number' && Number.isInteger(reps) && reps >= 1 && reps <= 10;
  }
  function epley(kg, reps) {
    if (!valid(kg, reps)) return null;
    return reps === 1 ? round1(kg) : round1(kg * (1 + reps / 30));
  }
  function brzycki(kg, reps) {
    if (!valid(kg, reps)) return null;
    return round1(kg * 36 / (37 - reps));
  }
  function mround(x, step) { return Math.round((x + Number.EPSILON) / step) * step; }
  function targetKg(oneRm, percent) {
    if (!(oneRm > 0) || !(percent > 0)) return null;
    return mround(oneRm * percent / 100, 2.5);
  }
  function loadTable(oneRm) {
    if (!(oneRm > 0)) return [];
    return PERCENT.map(function (p) { return { percent: p, kg: targetKg(oneRm, p) }; });
  }
  function fmt(x) { return x == null ? '–' : (Math.round(x * 10) / 10).toFixed(1); }
  return { PERCENT: PERCENT, epley: epley, brzycki: brzycki, targetKg: targetKg, loadTable: loadTable, fmt: fmt };
});
