// Self-test safe zone checker (no dependencies): node tests/safe-zone-checker/selbsttest.js
// zones.json = embedded copy = PNG overlays; sources + dates present; pixel check, timecode and range logic.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
let ok = 0, fail = 0;
const t = (c, m) => { c ? ok++ : fail++; if (!c) console.log('FAIL ' + m); };
const dir = path.join(__dirname, '..', '..', 'tools', 'safe-zone-checker');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const fileData = JSON.parse(fs.readFileSync(path.join(dir, 'zones.json'), 'utf8'));
const emb = JSON.parse(html.match(/<script type="application\/json" id="zonedata">([\s\S]*?)<\/script>/)[1]);
const Z = fileData.zones, W = 1080, H = 1920;

// --- data
t(JSON.stringify(emb) === JSON.stringify(fileData), 'embedded zone data equals zones.json');
t(/^\d{4}-\d{2}-\d{2}$/.test(fileData.version), 'version is a date');
t(Object.keys(Z).join() === 'tiktok,reels,shorts,combined', '4 platforms, file names unchanged');
const OFFICIAL = { tiktok: 'https://ads.tiktok.com/', reels: 'https://developers.facebook.com/', shorts: 'https://support.google.com/' };
for (const k in Z) { const z = Z[k];
  for (const s of ['t', 'b', 'r', 'l']) t(Number.isInteger(z[s]) && z[s] > 0 && z[s] < 800, `${k}.${s} plausible`);
  t(W - z.l - z.r >= 600 && H - z.t - z.b >= 900, `${k}: safe box not tiny`);
  t(/^\d{4}-\d{2}-\d{2}$/.test(z.checked) && !isNaN(Date.parse(z.checked)), `${k}: checked date`);
  t(typeof z.basis === 'string' && z.basis && typeof z.how === 'string' && z.how.length > 20, `${k}: basis + how`);
  t(z.source && z.source.title, `${k}: source title`);
  if (OFFICIAL[k]) t(z.source.url.startsWith(OFFICIAL[k]), `${k}: source is the official help/developer page`);
  t(Array.isArray(z.estimated) && z.estimated.every(s => 'tbrl'.includes(s)), `${k}: estimated list`);
  if (z.side) t(z.side.w > 0 && z.side.y > z.t && z.side.y < H - z.b, `${k}: button column inside the box`);
}
// pinned to the official measurements (TikTok Feed.png 720x1280 x1.5, Google overlay 1080x1920, Meta bottom 35%)
t(Z.tiktok.t === 240 && Z.tiktok.b === 660 && Z.tiktok.l === 120 && Z.tiktok.r === 120 && Z.tiktok.side.w === 180 && Z.tiktok.side.y === 840, 'TikTok = official file x1.5');
t(Z.shorts.t === 288 && Z.shorts.b === 672 && Z.shorts.l === 48 && Z.shorts.r === 192, 'Shorts = Google overlay');
t(Z.reels.b === Math.round(H * .35) && Z.reels.estimated.join() === 't,r,l' && Z.reels.basis === 'partly official', 'Reels: bottom 35% official, rest marked as estimate');
t(Z.tiktok.estimated.length === 0 && Z.shorts.estimated.length === 0, 'TikTok + Shorts: nothing estimated');
for (const s of ['t', 'b', 'r', 'l']) t(Z.combined[s] === Math.max(Z.tiktok[s], Z.reels[s], Z.shorts[s]), `combined.${s} = strictest`);
t(JSON.stringify(Z.combined.side) === JSON.stringify(Z.tiktok.side), 'combined keeps the button column');
t(!('stories' in Z), 'no Stories zone without a verified official source');

// --- logic from the page
const logic = html.match(/\/\*LOGIC\*\/([\s\S]*?)\/\*\/LOGIC\*\//)[1];
const L = new Function('W', 'H', 'Z', logic + ';return{safe,rects,scanLum,bad,tcs,ranges}')(W, H, Z);
t(JSON.stringify(L.safe('shorts')) === JSON.stringify({ x: 48, y: 288, w: 840, h: 960 }), 'safe box Shorts 840x960');
t(L.rects('reels').length === 4 && L.rects('tiktok').length === 5, 'rects: 4, with button column 5');
const bt = L.rects('tiktok').find(r => r.n === 'buttons');
t(bt.x === 780 && bt.y === 840 && bt.w === 180 && bt.h === 420, 'TikTok button column 780/840 180x420');
for (const k in Z) { const s = L.safe(k); t(L.rects(k).every(r => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H && r.w > 0 && r.h > 0), `${k}: rects inside the frame`);
  t(L.rects(k).filter(r => r.n !== 'buttons').every(r => r.x + r.w <= s.x || r.x >= s.x + s.w || r.y + r.h <= s.y || r.y >= s.y + s.h), `${k}: margins do not overlap the safe box`); }
// synthetic frames at 270x480 (scale .25)
const SW = 270, SH = 480, sc = SW / W;
const frame = fn => { const a = new Uint8Array(SW * SH).fill(40); fn && fn(a); return a; };
const text = (a, x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) a[y * SW + x] = ((x >> 1) + (y >> 1)) % 2 ? 250 : 5; }; // 2px checker = dense edges both ways
const scan = (a, k) => L.scanLum(a, SW, SH, L.rects(k), sc);
for (const k in Z) {
  t(L.bad(scan(frame(), k)).length === 0, `${k}: flat frame -> no warning`);
  const bz = Math.round((H - Z[k].b) * sc);
  t(L.bad(scan(frame(a => text(a, 60, bz + 30, 120, 36)), k)).join() === 'bottom', `${k}: caption in the bottom zone -> warning "bottom"`);
  t(L.bad(scan(frame(a => text(a, 60, Math.round(Z[k].t * sc) + 40, 100, 36)), k)).length === 0, `${k}: caption inside the safe box -> no warning`);
  t(L.bad(scan(frame(a => text(a, 60, 4, 150, Math.round(Z[k].t * sc) - 8)), k)).join() === 'top', `${k}: text under the top bar -> warning "top"`);
  t(L.bad(scan(frame(a => { for (let x = 0; x < SW; x++) for (let y = bz + 40; y < SH; y++) a[y * SW + x] = 250; }), k)).length === 0, `${k}: one horizontal edge (horizon) -> no warning`);
  t(L.bad(scan(frame(a => { for (let y = 0; y < SH; y++) for (let x = 100; x < SW; x++) a[y * SW + x] = 250; }), k)).length === 0, `${k}: one vertical edge -> no warning`);
  t(L.bad(scan(frame(a => { for (let i = 0; i < a.length; i++) a[i] = 100 + (i * 7919 % 30); }), k)).length === 0, `${k}: soft noise -> no warning`);
}
t(L.bad(scan(frame(a => text(a, 200, 230, 36, 60)), 'tiktok')).join() === 'buttons', 'TikTok: text under the button column -> warning "buttons"');
t(L.bad(scan(frame(a => text(a, 200, 230, 36, 60)), 'reels')).length === 0, 'Reels: same spot is safe (no button column)');
const one = scan(frame(a => text(a, 61, 397, 10, 10)), 'shorts'); // fits into one 12x12 cell (grid starts at y 312)
t(L.bad(one).length === 0, 'a single small cell is not enough for a warning');
const hit = scan(frame(a => text(a, 60, 400, 120, 36)), 'shorts').hits[0];
t(hit && hit.s === 48 && hit.y >= H - Z.shorts.b && hit.n === 'bottom', 'hit marks are in 1080x1920 pixels');
t(L.bad(null).length === 0, 'bad(null) is empty');
// timecode + ranges
t(L.tcs(0, 30) === '0:00.00' && L.tcs(1, 30) === '0:01.00' && L.tcs(1 + 1 / 30, 30) === '0:01.01' && L.tcs(61.5, 30) === '1:01.15' && L.tcs(59.99, 25) === '1:00.00', 'timecode m:ss.ff');
t(L.tcs(2.0005, 24) === '0:02.00' && L.tcs(1.9995, 60) === '0:02.00', 'timecode rounds to the nearest frame');
const rg = L.ranges([{ t: .25, z: ['bottom'] }, { t: .75, z: ['bottom'] }, { t: 1.25, z: ['bottom', 'top'] }, { t: 5, z: ['right'] }], .75);
t(rg.length === 2 && rg[0].a === .25 && rg[0].b === 1.25 && rg[0].z.join() === 'bottom,top' && rg[1].a === 5 && rg[1].z.join() === 'right', 'ranges merge neighbouring hits');
t(L.ranges([], 1).length === 0, 'ranges of nothing');

// --- page
for (const m of new Set([...html.matchAll(/\$\('(\w+)'\)/g)].map(x => x[1]))) t(html.includes(`id="${m}"`), `ID exists: ${m}`);
t(html.includes('<link rel="canonical" href="https://paulvolk-mac.github.io/wordcaps/tools/safe-zone-checker/">'), 'canonical unchanged');
t(html.includes('?ref=p03'), 'WordCaps link ?ref=p03');
t(html.includes('data-cf-beacon') && html.includes('<!-- look-v4 -->') && html.includes('<!-- handy-ergo -->'), 'beacon, look v4 and phone ergonomics kept');
t(!/\b(130|140|420|360) px\b/.test(html), 'no old approximations left in the texts');
t(html.includes('240 px') && html.includes('660 px') && html.includes('288 px') && html.includes('672 px'), 'FAQ uses the official numbers');
t(html.includes('ads only') && html.includes('It is a hint, not text recognition'), 'honest notes: ad zones, heuristic');
t(!/fetch\(|XMLHttpRequest|FormData/.test(html), 'no upload code');
for (const id of ['b1s', 'b1f', 'f1f', 'f1s', 'fps', 'scanb', 'chk', 'srcl']) t(html.includes(`id="${id}"`), `control ${id}`);

// --- PNG overlays match the data
function png(f) { const b = fs.readFileSync(f); const w = b.readUInt32BE(16), h = b.readUInt32BE(20), ct = b[25], bd = b[24]; let i = 8, idat = [];
  while (i < b.length) { const n = b.readUInt32BE(i), ty = b.toString('ascii', i + 4, i + 8); if (ty == 'IDAT') idat.push(b.slice(i + 8, i + 8 + n)); i += 12 + n; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = 4 * (bd / 8), st = w * bpp, px = Buffer.alloc(h * st); let prev = Buffer.alloc(st);
  for (let y = 0; y < h; y++) { const f = raw[y * (st + 1)], row = raw.slice(y * (st + 1) + 1, (y + 1) * (st + 1)), out = Buffer.alloc(st);
    for (let x = 0; x < st; x++) { const a = x >= bpp ? out[x - bpp] : 0, b2 = prev[x], c = x >= bpp ? prev[x - bpp] : 0; let v = row[x];
      if (f == 1) v += a; else if (f == 2) v += b2; else if (f == 3) v += (a + b2) >> 1; else if (f == 4) { const p = a + b2 - c, pa = Math.abs(p - a), pb = Math.abs(p - b2), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b2 : c); } out[x] = v & 255; }
    out.copy(px, y * st); prev = out; }
  return { w, h, ct, get: (x, y) => { const o = y * st + x * bpp, s = bd / 8; return [0, 1, 2, 3].map(k => px[o + k * s]); } }; }
const red = p => p[3] > 60 && p[3] < 200 && p[0] > 150 && p[1] < 120, green = p => p[1] > 150 && p[0] < 90 && p[3] > 200, clear = p => p[3] === 0;
for (const k in Z) for (const typ of ['safe_zone', 'guide_lines']) { const f = path.join(dir, 'png', `${k}_${typ}_1080x1920.png`);
  if (!fs.existsSync(f)) { t(false, 'missing ' + f); continue; }
  const p = png(f), z = Z[k], s = L.safe(k);
  t(p.w == W && p.h == H && p.ct == 6, `${k} ${typ}: 1080x1920 RGBA`);
  t(clear(p.get(z.l + 200, z.t + 300)), `${k} ${typ}: inside the box transparent`);
  t(green(p.get(z.l + 1, z.t + 300)) && green(p.get(z.l + 200, z.t + 1)) && green(p.get(z.l + 200, H - z.b - 2)), `${k} ${typ}: green line on left/top/bottom edge`);
  t(clear(p.get(z.l + 8, z.t + 300)) && clear(p.get(z.l + 200, z.t + 8)), `${k} ${typ}: line is thin`);
  if (typ == 'safe_zone') {
    t(red(p.get(540, H - 10)) && red(p.get(540, H - z.b + 100)) && red(p.get(700, 8)) && red(p.get(W - 5, z.t + 300)) && red(p.get(5, z.t + 300)), `${k}: all four margins shaded red`);
    t(clear(p.get(540, H - z.b - 12)) && clear(p.get(z.l + 12, z.t + 200)), `${k}: red ends at the margin`);
    if (z.side) { t(red(p.get(W - z.r - z.side.w + 20, z.side.y + 100)), `${k}: button column shaded`); t(clear(p.get(W - z.r - z.side.w - 12, z.side.y + 100)) && clear(p.get(W - z.r - 20, z.side.y - 30)), `${k}: column only where it belongs`); }
    else t(clear(p.get(W - z.r - 20, z.t + s.h - 100)), `${k}: no button column`);
  } else t(clear(p.get(540, H - 10)) && clear(p.get(540, 5)), `${k} guide lines: margins transparent`);
}
// --- ZIP for the download button (stored/deflated central directory names)
const zipf = path.join(dir, 'SafeZoneOverlays_2026.zip'); t(fs.existsSync(zipf), 'ZIP exists');
if (fs.existsSync(zipf)) { const b = fs.readFileSync(zipf), names = {}; let i = b.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6])); const n = b.readUInt16LE(i + 10); let o = b.readUInt32LE(i + 16);
  for (let k = 0; k < n; k++) { const nl = b.readUInt16LE(o + 28), el = b.readUInt16LE(o + 30), cl = b.readUInt16LE(o + 32); names[b.toString('utf8', o + 46, o + 46 + nl)] = { size: b.readUInt32LE(o + 24), crc: b.readUInt32LE(o + 16) }; o += 46 + nl + el + cl; }
  for (const k in Z) for (const typ of ['safe_zone', 'guide_lines']) { const nm = `${k}_${typ}_1080x1920.png`; t(names[nm] && names[nm].size === fs.statSync(path.join(dir, 'png', nm)).size, `ZIP has the current ${nm}`); }
  // zones.json is text: a Windows checkout (core.autocrlf) has CRLF, the ZIP and the live site have LF -> compare LF-normalised content
  const zj = Buffer.from(fs.readFileSync(path.join(dir, 'zones.json'), 'latin1').replace(/\r\n/g, '\n'), 'latin1'), zcrc = require('zlib').crc32;
  t(names['zones.json'] && names['zones.json'].size === zj.length && (!zcrc || names['zones.json'].crc === zcrc(zj) >>> 0), 'ZIP has zones.json (sources + date)');
  t(names['README.txt'] && names['LICENSE.txt'], 'ZIP has README + LICENSE');
  t(!Object.keys(names).some(x => x.startsWith('checker/')), 'ZIP no longer ships the old checker copy with old values'); }
console.log(`Self-test safe zone checker: ${ok} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
