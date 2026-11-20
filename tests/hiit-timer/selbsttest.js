// Unit tests for the HIIT timer: node tests/hiit-timer/selbsttest.js
// Reads the engine straight out of tools/hiit-timer/index.html (single-file tool, no build step).
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', '..', 'tools', 'hiit-timer');
const h = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const js = h.split('<script>')[1].split('</script>')[0];
const m = { exports: {} }; new Function('module', js)(m);
const { buildPlan, totalSec, stateAt, fmt, clampCfg, PRESETS, wkName, wkClean, wkParse, wkAdd, wkDel, WK_MAX } = m.exports;
let ok = 0, bad = 0; const t = (n, c) => { if (c) { ok++ } else { bad++; console.log('FAIL', n) } };

// ---- timer engine
const tab = buildPlan({ ...PRESETS['Tabata'], prep: 10 });
t('tabata segs', tab.length === 1 + 8 + 7); t('tabata total', totalSec(tab) === 10 + 160 + 70); t('tabata no rest after last', tab[tab.length - 1].k === 'work');
t('state prep', stateAt(tab, 0).seg.k === 'prep' && stateAt(tab, 0).left === 10);
t('state work1', stateAt(tab, 10).seg.k === 'work' && stateAt(tab, 10).seg.r === 1);
t('state rest1', stateAt(tab, 30.5).seg.k === 'rest'); t('state work2', stateAt(tab, 40).seg.r === 2);
t('state done', stateAt(tab, 240).seg === null); t('state just before end', stateAt(tab, 239.9).seg.k === 'work' && stateAt(tab, 239.9).seg.r === 8);
const em = buildPlan({ ...PRESETS['EMOM 10'], prep: 0 }); t('emom 10 x 60', em.length === 10 && totalSec(em) === 600 && em.every(x => x.k === 'work'));
const sets = buildPlan({ work: 30, rest: 10, rounds: 3, sets: 2, setrest: 60, prep: 0 });
t('sets order', sets.map(x => x.k).join(',') === 'work,rest,work,rest,work,setrest,work,rest,work,rest,work'); t('sets total', totalSec(sets) === 180 + 40 + 60);
t('sets set2', sets[6].s === 2 && sets[6].r === 1);
const noRest = buildPlan({ work: 20, rest: 0, rounds: 3, sets: 1, setrest: 0, prep: 5 }); t('rest 0 skipped', noRest.length === 4);
t('fmt 0', fmt(0) === '0:00'); t('fmt ceil', fmt(9.2) === '0:10'); t('fmt exact', fmt(10) === '0:10'); t('fmt min', fmt(185) === '3:05'); t('fmt neg', fmt(-3) === '0:00');
const cc = clampCfg({ work: 'abc', rest: -5, rounds: 500, sets: 0, setrest: '30', prep: 99 });
t('clamp default', cc.work === 45); t('clamp rest', cc.rest === 0); t('clamp rounds', cc.rounds === 99); t('clamp sets', cc.sets === 1); t('clamp str', cc.setrest === 30); t('clamp prep', cc.prep === 60);
let prev = -1, mono = true; for (let x = 0; x < 240; x += 0.25) { const i = stateAt(tab, x).i; if (i < prev) mono = false; prev = i } t('monotonic', mono);
t('presets 6', Object.keys(PRESETS).length === 6);

// ---- My workouts (pure list helpers)
const A = { work: 50, rest: 10, rounds: 7, sets: 1, setrest: 60, prep: 10 };
t('wkName', wkName(A) === '50/10 × 7'); t('wkName sets', wkName({ ...A, sets: 3 }) === '50/10 × 7 · 3 sets');
t('wkClean spaces', wkClean('  Leg   day \n finisher ') === 'Leg day finisher'); t('wkClean 40', wkClean('x'.repeat(60)).length === 40);
t('wkClean null', wkClean(null) === '' && wkClean(undefined) === '' && wkClean(7) === '7');
let l = wkAdd([], 'Leg day', A);
t('add first', l.length === 1 && l[0].name === 'Leg day' && l[0].work === 50 && l[0].rounds === 7);
const l2 = wkAdd(l, 'Arms', { ...A, work: 30 });
t('add on top', l2.length === 2 && l2[0].name === 'Arms' && l2[1].name === 'Leg day'); t('add does not mutate', l.length === 1);
const l3 = wkAdd(l2, '  leg DAY ', { ...A, work: 20 });
t('same name updates in place', l3.length === 2 && l3[1].name === 'leg DAY' && l3[1].work === 20 && l3[0].name === 'Arms');
t('empty name gets default', wkAdd([], '   ', A)[0].name === '50/10 × 7');
const dirty = wkAdd([], 'Bad', { work: 'abc', rest: -3, rounds: 1e9, sets: 0, setrest: '15', prep: 999 })[0];
t('add clamps values', dirty.work === 45 && dirty.rest === 0 && dirty.rounds === 99 && dirty.sets === 1 && dirty.setrest === 15 && dirty.prep === 60);
let full = []; for (let i = 0; i < WK_MAX; i++) full = wkAdd(full, 'W' + i, A);
t('max reached', full.length === WK_MAX && WK_MAX === 30); t('full list refuses new (same reference)', wkAdd(full, 'one more', A) === full);
const fullUpd = wkAdd(full, 'w3', { ...A, work: 99 }); t('full list still updates existing', fullUpd !== full && fullUpd.length === WK_MAX && fullUpd.find(x => x.name === 'w3').work === 99);
t('del', wkDel(l2, 'Arms').length === 1 && wkDel(l2, 'Arms')[0].name === 'Leg day'); t('del unknown', wkDel(l2, 'nope').length === 2); t('del exact name only', wkDel(l2, 'arms').length === 2);
t('parse empty', wkParse('').length === 0 && wkParse(null).length === 0 && wkParse(undefined).length === 0);
t('parse garbage', wkParse('{{{').length === 0 && wkParse('{"a":1}').length === 0 && wkParse('"x"').length === 0 && wkParse('42').length === 0);
const p = wkParse(JSON.stringify([null, 5, 'x', {}, { name: '' }, { name: 42 }, { name: ' Ok ', work: 'zz', rounds: 1e6 }, { name: 'OK', work: 1 }, { name: '<img src=x onerror=alert(1)>', work: 10 }]));
t('parse skips broken entries + duplicates', p.length === 3 && p[0].name === '42' && p[1].name === 'Ok' && p[2].name.startsWith('<img'));
t('parse clamps', p[1].work === 45 && p[1].rounds === 99);
t('parse caps at max', wkParse(JSON.stringify(Array.from({ length: 80 }, (_, i) => ({ name: 'n' + i })))).length === WK_MAX);
t('roundtrip', JSON.stringify(wkParse(JSON.stringify(l3))) === JSON.stringify(l3));
const loaded = buildPlan(l3[1]); t('saved workout builds a plan', totalSec(loaded) === 10 + 7 * 20 + 6 * 10);

// ---- markup
const ui = js.split('// ===== UI')[1] || ''; const ids = [...new Set([...ui.matchAll(/\$\('([a-zA-Z]+)'\)/g)].map(x => x[1]))];
const miss = ids.filter(i => !h.includes('id="' + i + '"')); t('ids exist ' + miss.join(','), ids.length > 10 && miss.length === 0);
const steps = [...h.matchAll(/data-f="([a-z]+)"/g)].map(x => x[1]); t('stepper 12', steps.length === 12 && steps.every(f => h.includes('id="' + f + '"')));
t('canonical', h.includes('tools/hiit-timer/')); t('no placeholder', !h.includes('/*ENGINE*/') && !h.includes('/*CSS*/'));
t('names never go through innerHTML', !/innerHTML[^;\n]*\.name/.test(ui) && /n\.textContent=w\.name/.test(ui));
t('own storage key', ui.includes("'hiit5w'") && ui.includes("'hiit5'"));

// ---- PWA files
t('manifest linked', h.includes('<link rel="manifest" href="manifest.webmanifest">')); t('sw registered', ui.includes("serviceWorker.register('sw.js')"));
let mf = {}; try { mf = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.webmanifest'), 'utf8')) } catch (e) { t('manifest is JSON', false) }
t('manifest basics', !!mf.name && !!mf.short_name && mf.short_name.length <= 12 && mf.display === 'standalone' && mf.start_url === './' && mf.scope === './');
const ic = mf.icons || [];
t('manifest icons 192 + 512 + maskable', ic.some(i => i.sizes === '192x192') && ic.some(i => i.sizes === '512x512' && i.purpose === 'any') && ic.some(i => i.purpose === 'maskable'));
const png = f => { try { const b = fs.readFileSync(path.join(DIR, f)); return b.slice(1, 4).toString() === 'PNG' ? b.readUInt32BE(16) + 'x' + b.readUInt32BE(20) : '' } catch (e) { return '' } };
t('icon files match their declared size', ic.length === 3 && ic.every(i => png(i.src) === i.sizes));
const sw = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8'); const shell = JSON.parse((sw.match(/SHELL = (\[[^\]]+\])/) || [0, '[]'])[1].replace(/'/g, '"'));
t('sw precache list exists on disk', shell.length >= 4 && shell.every(f => f === './' || fs.existsSync(path.join(DIR, f))));
t('sw caches every manifest icon', ic.every(i => shell.includes(i.src)) && shell.includes('manifest.webmanifest'));
t('sw only touches its own caches', sw.includes("k.startsWith('hiit-')"));

console.log(`Selbsttest HIIT timer: ${ok} OK, ${bad} FAIL`); process.exit(bad ? 1 : 0);
