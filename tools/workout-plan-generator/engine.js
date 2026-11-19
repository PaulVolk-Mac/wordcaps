// Workout Plan Generator – engine (pure functions, no DOM). Tested by selbsttest.js.
// A-190 Taler feature (P07 web companion). Used by index.html via <script src="engine.js">.
(function (root) {
'use strict';

// Exercise library: pattern -> equipment -> variants (A, B, ...). null = not available with that equipment.
const LIB = {
  squat:   { gym: ['Squat', 'Front squat'], db: ['Goblet squat', 'Dumbbell squat'], bw: ['Bodyweight squat', 'Jump squat'] },
  hinge:   { gym: ['Romanian deadlift', 'Deadlift'], db: ['Dumbbell Romanian deadlift', 'Single-leg Romanian deadlift'], bw: ['Glute bridge', 'Single-leg Romanian deadlift'] },
  lunge:   { gym: ['Bulgarian split squat', 'Leg press'], db: ['Bulgarian split squat', 'Dumbbell reverse lunge'], bw: ['Reverse lunge', 'Bulgarian split squat'] },
  hpush:   { gym: ['Bench press', 'Incline dumbbell press'], db: ['Dumbbell floor press', 'Push-ups'], bw: ['Push-ups', 'Decline push-ups'] },
  vpush:   { gym: ['Overhead press', 'Dumbbell shoulder press'], db: ['Dumbbell shoulder press', 'Arnold press'], bw: ['Pike push-ups', 'Elevated pike push-ups'] },
  hpull:   { gym: ['Barbell row', 'Seated cable row'], db: ['Dumbbell row', 'Chest-supported dumbbell row'], bw: ['Inverted row', 'Towel doorframe row'] },
  vpull:   { gym: ['Lat pulldown', 'Pull-ups'], db: ['Dumbbell pullover', 'Renegade row'], bw: ['Pull-ups (or negatives)', 'Chin-ups (or negatives)'] },
  glute:   { gym: ['Hip thrust'], db: ['Dumbbell hip thrust'], bw: ['Single-leg hip bridge'] },
  hamcurl: { gym: ['Leg curl'], db: ['Single-leg Romanian deadlift'], bw: ['Single-leg hip bridge'] },
  quad:    { gym: ['Leg extension'], db: ['Dumbbell step-up'], bw: ['Step-up'] },
  calves:  { gym: ['Calf raise'], db: ['Dumbbell calf raise'], bw: ['Single-leg calf raise'] },
  chest:   { gym: ['Cable fly'], db: ['Dumbbell fly'], bw: null },
  lateral: { gym: ['Lateral raise'], db: ['Lateral raise'], bw: null },
  rear:    { gym: ['Face pull'], db: ['Rear delt fly'], bw: ['Prone Y-raise'] },
  biceps:  { gym: ['Barbell curl', 'Hammer curl'], db: ['Dumbbell curl', 'Hammer curl'], bw: null },
  triceps: { gym: ['Triceps pushdown', 'Skull crusher'], db: ['Overhead dumbbell extension', 'Dumbbell skull crusher'], bw: ['Bench dips', 'Diamond push-ups'] },
  core:    { gym: ['Plank', 'Cable crunch', 'Hanging leg raise'], db: ['Plank', 'Dead bug', 'Plank'], bw: ['Plank', 'Hollow hold', 'Lying leg raise'] },
};
const COMPOUND = new Set(['squat', 'hinge', 'lunge', 'hpush', 'vpush', 'hpull', 'vpull']);
const TIMED = new Set(['Plank', 'Hollow hold']);
const LOWER = new Set(['squat', 'hinge', 'lunge', 'glute', 'hamcurl', 'quad', 'calves']);

// Session templates: [pattern, variant]
const S = {
  fbA: ['Full body A', [['squat', 0], ['hpush', 0], ['hpull', 0], ['hinge', 0], ['triceps', 0], ['core', 0]]],
  fbB: ['Full body B', [['hinge', 1], ['vpush', 0], ['vpull', 0], ['lunge', 0], ['biceps', 0], ['core', 1]]],
  fbC: ['Full body C', [['squat', 1], ['hpush', 1], ['hpull', 1], ['glute', 0], ['rear', 0], ['core', 2]]],
  upA: ['Upper A', [['hpush', 0], ['hpull', 0], ['vpush', 0], ['vpull', 0], ['biceps', 0], ['triceps', 0]]],
  loA: ['Lower A', [['squat', 0], ['hinge', 0], ['lunge', 1], ['hamcurl', 0], ['calves', 0], ['core', 0]]],
  upB: ['Upper B', [['hpush', 1], ['vpull', 1], ['hpull', 1], ['lateral', 0], ['rear', 0], ['biceps', 1]]],
  loB: ['Lower B', [['hinge', 1], ['lunge', 0], ['glute', 0], ['quad', 0], ['calves', 0], ['core', 1]]],
  push: ['Push', [['hpush', 0], ['vpush', 0], ['hpush', 1], ['lateral', 0], ['triceps', 0], ['chest', 0]]],
  pull: ['Pull', [['vpull', 1], ['hpull', 0], ['hinge', 1], ['rear', 0], ['biceps', 0], ['core', 2]]],
  legs: ['Legs', [['squat', 0], ['hinge', 0], ['lunge', 1], ['hamcurl', 0], ['calves', 0], ['core', 0]]],
  pushB: ['Push B', [['vpush', 1], ['hpush', 1], ['chest', 0], ['lateral', 0], ['triceps', 1], ['core', 1]]],
  pullB: ['Pull B', [['vpull', 0], ['hpull', 1], ['rear', 0], ['biceps', 1], ['hamcurl', 0], ['core', 2]]],
  legsB: ['Legs B', [['squat', 1], ['lunge', 0], ['glute', 0], ['quad', 0], ['calves', 0], ['core', 1]]],
  upper: ['Upper', [['hpull', 0], ['hpush', 1], ['vpull', 0], ['vpush', 1], ['triceps', 1], ['biceps', 1]]],
  lower: ['Lower', [['squat', 1], ['glute', 0], ['lunge', 0], ['quad', 0], ['calves', 0], ['core', 2]]],
};
const SPLITS = {
  2: { name: 'Full body ×2', week: [['fbA', 'fbB']], days: [0, 3] },
  3: { name: 'Full body ×3', week: [['fbA', 'fbB', 'fbC']], days: [0, 2, 4] },
  3.1: { name: 'Full body A/B alternating', week: [['fbA', 'fbB', 'fbA'], ['fbB', 'fbA', 'fbB']], days: [0, 2, 4] },
  4: { name: 'Upper / Lower', week: [['upA', 'loA', 'upB', 'loB']], days: [0, 1, 3, 4] },
  5: { name: 'Push / Pull / Legs + Upper / Lower', week: [['push', 'pull', 'legs', 'upper', 'lower']], days: [0, 1, 2, 4, 5] },
  6: { name: 'Push / Pull / Legs ×2', week: [['push', 'pull', 'legs', 'pushB', 'pullB', 'legsB']], days: [0, 1, 2, 3, 4, 5] },
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Reps/sets/rest per goal. main = first compound of the session.
const SCHEME = {
  strength: { main: [4, 3, 5, 180], comp: [3, 6, 8, 120], iso: [2, 10, 12, 75], bwComp: [4, 5, 10, 120], time: [3, 20, 30, 60] },
  muscle:   { main: [3, 6, 10, 150], comp: [3, 8, 12, 120], iso: [3, 10, 15, 60], bwComp: [3, 8, 15, 90], time: [3, 30, 45, 60] },
  fitness:  { main: [3, 10, 12, 75], comp: [3, 10, 15, 60], iso: [2, 12, 20, 45], bwComp: [3, 12, 20, 60], time: [3, 45, 60, 45] },
};
const WEEKS = [
  { w: 1, label: 'Week 1 – Learn', rir: 3, note: 'Start at the bottom of each rep range. Leave about 3 reps in the tank. Write down every weight.' },
  { w: 2, label: 'Week 2 – Build', rir: 2, note: 'Same weights. Add reps until you reach the top of the range in every set.' },
  { w: 3, label: 'Week 3 – Push', rir: 1, note: 'Hit the top of the range in all sets? Add weight. The last rep of each set should be hard.' },
  { w: 4, label: 'Week 4 – Deload', rir: 4, note: 'Half the sets, about 90 % of your week-3 weights. Recover, then start the next block from week 1 with your new weights.', deload: true },
];
const MAX_EX = { beginner: 5, intermediate: 6, advanced: 6 };
const GOALS = ['strength', 'muscle', 'fitness'], EQUIP = ['gym', 'db', 'bw'], LEVELS = ['beginner', 'intermediate', 'advanced'];

function clampCfg(c) {
  c = c || {};
  const pick = (v, list, d) => (list.indexOf(v) >= 0 ? v : d);
  let d = Math.round(+c.days);
  if (!isFinite(d)) d = 3;
  d = Math.min(6, Math.max(2, d));
  return { goal: pick(c.goal, GOALS, 'muscle'), days: d, equip: pick(c.equip, EQUIP, 'gym'), level: pick(c.level, LEVELS, 'beginner') };
}

function increment(pattern, ex, equip) {
  if (equip === 'bw') return '+1–2 reps or a harder variation';
  if (equip === 'db') return 'next dumbbell (+1–2 kg)';
  if (COMPOUND.has(pattern) && LOWER.has(pattern) && ex !== 'Bulgarian split squat') return '+5 kg';
  if (COMPOUND.has(pattern)) return '+2.5 kg';
  return '+1–2.5 kg';
}

function sessionItems(key, cfg) {
  const [name, slots] = S[key];
  const used = new Set(), items = [];
  let mainDone = false;
  for (const [pat, v] of slots) {
    const opts = LIB[pat][cfg.equip];
    if (!opts) continue;
    // preferred variant first, then the others, skip duplicates within the session
    const order = [opts[v % opts.length]].concat(opts.filter((_, i) => i !== v % opts.length));
    const ex = order.find(e => !used.has(e));
    if (!ex) continue;
    used.add(ex);
    const sc = SCHEME[cfg.goal];
    let s, type;
    if (TIMED.has(ex)) { s = sc.time; type = 'time'; }
    else if (COMPOUND.has(pat)) {
      type = 'compound';
      if (cfg.equip === 'bw') s = sc.bwComp;
      else s = mainDone ? sc.comp : sc.main;
      mainDone = true;
    } else { s = sc.iso; type = 'iso'; }
    let sets = s[0];
    if (cfg.level === 'beginner' && type === 'compound' && sets > 3) sets = 3;
    if (cfg.level === 'advanced' && type === 'compound' && items.filter(i => i.type === 'compound').length < 2) sets += 1;
    items.push({ ex, pattern: pat, type, sets, lo: s[1], hi: s[2], rest: s[3], unit: type === 'time' ? 's' : 'reps', inc: type === 'time' ? '+5–10 s' : increment(pat, ex, cfg.equip) });
  }
  // too many exercises for the level: drop isolation work first (keep compounds and core)
  while (items.length > MAX_EX[cfg.level]) {
    let i = items.length - 1;
    while (i >= 0 && (items[i].type === 'compound' || items[i].pattern === 'core')) i--;
    items.splice(i >= 0 ? i : items.length - 1, 1);
  }
  return { key, name, items };
}

function splitFor(cfg) {
  if (cfg.days === 3 && cfg.level === 'beginner') return SPLITS[3.1];
  return SPLITS[cfg.days];
}

// Full 4-week plan.
function generatePlan(input) {
  const cfg = clampCfg(input);
  const sp = splitFor(cfg);
  const weeks = WEEKS.map((W, wi) => {
    const keys = sp.week[wi % sp.week.length];
    const days = keys.map((k, di) => {
      const s = sessionItems(k, cfg);
      const items = s.items.map(it => Object.assign({}, it, { sets: W.deload ? Math.max(1, Math.ceil(it.sets / 2)) : it.sets }));
      return { day: WEEKDAYS[sp.days[di]], name: s.name, items };
    });
    return { w: W.w, label: W.label, rir: W.rir, note: W.note, deload: !!W.deload, days };
  });
  const notes = [];
  if (cfg.level === 'beginner' && cfg.days >= 5) notes.push('Beginners usually progress fastest on 3–4 days a week. 5–6 days works too if you sleep and eat well.');
  if (cfg.equip === 'bw') notes.push('Bodyweight: a pull-up bar or a sturdy table makes pulling exercises possible. Make an exercise harder (slower, paused, one leg) when you pass the top of the range.');
  if (cfg.equip === 'db') notes.push('Dumbbells: a pair of adjustable dumbbells is enough. A bench helps, but every exercise here also works on the floor.');
  return { cfg, split: sp.name, weeks, notes };
}

function fmtTarget(it) {
  return it.sets + ' × ' + it.lo + '–' + it.hi + (it.unit === 's' ? ' s' : '');
}

function fmtRest(sec) {
  return sec >= 60 ? (sec % 60 ? Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') + ' min' : sec / 60 + ' min') : sec + ' s';
}

function csvCell(v) {
  v = String(v == null ? '' : v);
  if (/^[=+\-@]/.test(v)) v = "'" + v; // no formula injection in Excel/Sheets
  return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// One row per set, ready to paste into the Workout Tracker log (Reps/kg left empty).
function toCSV(plan) {
  const rows = [['Week', 'Date', 'Day / focus', 'Exercise', 'Set', 'Target', 'Rest', 'Reps', 'kg']];
  for (const W of plan.weeks) for (const d of W.days) for (const it of d.items) for (let s = 1; s <= it.sets; s++) {
    rows.push([W.w, '', d.day + ' – ' + d.name, it.ex, s, it.lo + '–' + it.hi + (it.unit === 's' ? ' s' : ''), fmtRest(it.rest), '', '']);
  }
  return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function weeklyPatterns(plan, w) {
  const n = {};
  for (const d of plan.weeks[w].days) for (const it of d.items) n[it.pattern] = (n[it.pattern] || 0) + it.sets;
  return n;
}

function toQuery(cfg) { cfg = clampCfg(cfg); return 'g=' + cfg.goal + '&d=' + cfg.days + '&e=' + cfg.equip + '&l=' + cfg.level; }
function fromQuery(q) {
  const p = new URLSearchParams(q);
  return clampCfg({ goal: p.get('g'), days: p.get('d'), equip: p.get('e'), level: p.get('l') });
}

const API = { LIB, SPLITS, WEEKS, GOALS, EQUIP, LEVELS, clampCfg, generatePlan, fmtTarget, fmtRest, toCSV, csvCell, weeklyPatterns, toQuery, fromQuery };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.WPG = API;
})(typeof window !== 'undefined' ? window : this);
