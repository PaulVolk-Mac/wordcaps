// Self-test for the Workout Plan Generator engine. Run: node selbsttest.js
const E = require('./engine.js');
let ok = 0, fail = 0;
function t(name, cond, info) { if (cond) ok++; else { fail++; console.log('FAIL', name, info === undefined ? '' : JSON.stringify(info)); } }

const all = [];
for (const goal of E.GOALS) for (let days = 2; days <= 6; days++) for (const equip of E.EQUIP) for (const level of E.LEVELS) all.push({ goal, days, equip, level });

// 1) Every combination: right number of days, no empty day, 4 weeks, valid exercises, no duplicate per session
for (const c of all) {
  const p = E.generatePlan(c), id = c.goal + '/' + c.days + '/' + c.equip + '/' + c.level;
  const okWeeks = p.weeks.length === 4;
  const okDays = p.weeks.every(W => W.days.length === c.days);
  const noEmpty = p.weeks.every(W => W.days.every(d => d.items.length >= 3));
  const valid = p.weeks.every(W => W.days.every(d => d.items.every(it => (E.LIB[it.pattern][c.equip] || []).indexOf(it.ex) >= 0)));
  const noDup = p.weeks.every(W => W.days.every(d => new Set(d.items.map(i => i.ex)).size === d.items.length));
  const ranges = p.weeks.every(W => W.days.every(d => d.items.every(it => it.lo > 0 && it.hi > it.lo && it.sets >= 1 && it.rest >= 30)));
  const cap = p.weeks.every(W => W.days.every(d => d.items.length <= (c.level === 'beginner' ? 5 : 6)));
  t('weeks ' + id, okWeeks); t('days ' + id, okDays); t('no empty day ' + id, noEmpty);
  t('valid exercises ' + id, valid); t('no duplicate ' + id, noDup); t('ranges ' + id, ranges); t('max exercises ' + id, cap);
  // every week trains squat/lunge, hinge/glute, a push and a pull pattern
  const wp = E.weeklyPatterns(p, 0);
  t('balanced ' + id, (wp.squat || wp.lunge) && (wp.hinge || wp.glute) && (wp.hpush || wp.vpush) && (wp.hpull || wp.vpull), wp);
  // deload week has fewer total sets than week 3
  const sets = w => p.weeks[w].days.reduce((a, d) => a + d.items.reduce((b, i) => b + i.sets, 0), 0);
  t('deload lighter ' + id, sets(3) < sets(2) && p.weeks[3].deload, [sets(2), sets(3)]);
}

// 2) Goal changes the rep ranges in the expected direction
const first = g => E.generatePlan({ goal: g, days: 4, equip: 'gym', level: 'intermediate' }).weeks[0].days[0].items[0];
t('strength low reps', first('strength').hi <= 5, first('strength'));
t('muscle mid reps', first('muscle').lo >= 6 && first('muscle').hi <= 12, first('muscle'));
t('fitness high reps', first('fitness').lo >= 10, first('fitness'));
t('strength rests longest', first('strength').rest > first('muscle').rest && first('muscle').rest > first('fitness').rest);

// 3) Level
const lv = l => E.generatePlan({ goal: 'strength', days: 4, equip: 'gym', level: l }).weeks[0].days[0].items[0].sets;
t('beginner max 3 sets on compounds', lv('beginner') === 3, lv('beginner'));
t('advanced +1 set on main lift', lv('advanced') === lv('intermediate') + 1, [lv('advanced'), lv('intermediate')]);
const beg3 = E.generatePlan({ goal: 'muscle', days: 3, equip: 'gym', level: 'beginner' });
t('beginner 3 days alternates A-B-A / B-A-B', beg3.weeks[0].days.map(d => d.name).join() === 'Full body A,Full body B,Full body A' && beg3.weeks[1].days.map(d => d.name).join() === 'Full body B,Full body A,Full body B', beg3.weeks.map(w => w.days.map(d => d.name)));
t('intermediate 3 days A-B-C', E.generatePlan({ days: 3, level: 'intermediate' }).weeks[0].days.map(d => d.name).join() === 'Full body A,Full body B,Full body C');
t('beginner 5 days note', E.generatePlan({ days: 5, level: 'beginner' }).notes.length === 1);

// 4) Equipment specifics
const bw = E.generatePlan({ goal: 'muscle', days: 4, equip: 'bw', level: 'intermediate' });
t('bodyweight has no barbell/cable', !JSON.stringify(bw).match(/Barbell|Cable|Lat pulldown|Leg press|Bench press/));
t('bodyweight increment is reps', bw.weeks[0].days[0].items.filter(i => i.type !== 'time').every(i => /reps/.test(i.inc)));
t('dumbbell has no barbell', !JSON.stringify(E.generatePlan({ days: 5, equip: 'db' })).match(/Barbell|Cable|Lat pulldown|Leg press/));
const sq = E.generatePlan({ days: 4, equip: 'gym', level: 'intermediate' }).weeks[0].days[1].items[0];
t('squat +5 kg', sq.ex === 'Squat' && sq.inc === '+5 kg', sq);
t('plank is timed', E.generatePlan({ days: 2 }).weeks[0].days[0].items.some(i => i.ex === 'Plank' && i.unit === 's'));
t('weekdays 4 days Mon Tue Thu Fri', E.generatePlan({ days: 4 }).weeks[0].days.map(d => d.day).join() === 'Mon,Tue,Thu,Fri');

// 5) Input clamping + URL
t('clamp days high', E.clampCfg({ days: 9 }).days === 6);
t('clamp days low', E.clampCfg({ days: 0 }).days === 2);
t('clamp junk', JSON.stringify(E.clampCfg({ goal: 'x', days: 'abc', equip: '<b>', level: null })) === JSON.stringify({ goal: 'muscle', days: 3, equip: 'gym', level: 'beginner' }));
const q = E.toQuery({ goal: 'fitness', days: 5, equip: 'db', level: 'advanced' });
t('query roundtrip', JSON.stringify(E.fromQuery(q)) === JSON.stringify({ goal: 'fitness', days: 5, equip: 'db', level: 'advanced' }), q);

// 6) CSV
const p4 = E.generatePlan({ goal: 'muscle', days: 4, equip: 'gym', level: 'intermediate' });
const csv = E.toCSV(p4), lines = csv.replace(/^﻿/, '').trim().split('\r\n');
const totalSets = p4.weeks.reduce((a, W) => a + W.days.reduce((b, d) => b + d.items.reduce((c, i) => c + i.sets, 0), 0), 0);
t('csv header', lines[0] === 'Week,Date,Day / focus,Exercise,Set,Target,Rest,Reps,kg', lines[0]);
t('csv one row per set', lines.length - 1 === totalSets, [lines.length - 1, totalSets]);
t('csv 9 columns', lines.slice(1).every(l => l.split(',').length === 9));
t('csv BOM for Excel', csv.charCodeAt(0) === 0xfeff);
t('csv quotes comma', E.csvCell('a,b') === '"a,b"');
t('csv escapes quotes', E.csvCell('say "hi"') === '"say ""hi"""');
t('csv blocks formulas', E.csvCell('=HYPERLINK(1)') === "'=HYPERLINK(1)");

// 7) Formatting
t('fmtRest 90', E.fmtRest(90) === '1:30 min'); t('fmtRest 120', E.fmtRest(120) === '2 min'); t('fmtRest 45', E.fmtRest(45) === '45 s');
t('fmtTarget', E.fmtTarget({ sets: 3, lo: 8, hi: 12, unit: 'reps' }) === '3 × 8–12');

console.log('Combinations:', all.length, '| OK:', ok, '| FAIL:', fail);
process.exit(fail ? 1 : 0);
