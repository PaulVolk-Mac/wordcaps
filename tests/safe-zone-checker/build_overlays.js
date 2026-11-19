// Builds the 8 PNG overlays (1080x1920, transparent) from tools/safe-zone-checker/zones.json with ffmpeg.
// Usage: node tests/safe-zone-checker/build_overlays.js   (dev tool, not shipped to the page)
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const dir = path.join(__dirname, '..', '..', 'tools', 'safe-zone-checker');
const { zones } = JSON.parse(fs.readFileSync(path.join(dir, 'zones.json'), 'utf8'));
const W = 1080, H = 1920, FONT = "C\\:/Windows/Fonts/segoeuib.ttf", LW = 4;
const box = (x, y, w, h, c) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${c}:t=fill`;
function rects(z) {
  const sh = H - z.t - z.b, a = [[0, 0, W, z.t], [0, H - z.b, W, z.b], [W - z.r, z.t, z.r, sh], [0, z.t, z.l, sh]];
  if (z.side) a.push([W - z.r - z.side.w, z.side.y, z.side.w, H - z.b - z.side.y]);
  return a;
}
function outline(z) { // green safe shape as thin filled boxes (L-shape when there is a button column)
  const x0 = z.l, x1 = W - z.r, y0 = z.t, y1 = H - z.b;
  const p = z.side ? [[x0, y0], [x1, y0], [x1, z.side.y], [x1 - z.side.w, z.side.y], [x1 - z.side.w, y1], [x0, y1]] : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return p.map((a, i) => { const b = p[(i + 1) % p.length];
    return a[1] === b[1] ? [Math.min(a[0], b[0]), a[1] - (a[1] === y1 ? LW : 0), Math.abs(a[0] - b[0]), LW]
                         : [a[0] - (a[0] === x0 ? 0 : LW), Math.min(a[1], b[1]), LW, Math.abs(a[1] - b[1])]; });
}
function run(filter, out) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}`, '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}`,
    '-frames:v', '1', '-filter_complex', filter, out], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
}
for (const k in zones) {
  const z = zones[k], lab = z.name.toUpperCase(), ln = outline(z), yb = H - z.b;
  const txt = c => `drawtext=fontfile='${FONT}':text='${lab} SAFE ZONE':fontsize=40:x=${z.l}+(${W - z.l - z.r}-tw)/2:y=${z.t + 24}:fontcolor=${c},` +
    `drawtext=fontfile='${FONT}':text='keep text + faces inside the green shape':fontsize=28:x=${z.l}+24:y=${yb - 56}:fontcolor=${c}`;
  const col = [...rects(z).map(r => box(...r, '0xE53935')), ...ln.map(r => box(...r, '0x00E676')), txt('white')].join(',');
  const msk = [...rects(z).map(r => box(...r, '0x616161')), ...ln.map(r => box(...r, 'white')), txt('white')].join(',');
  run(`[0]${col},format=rgb24[c];[1]${msk},format=gray[m];[c][m]alphamerge,format=rgba`, path.join(dir, 'png', `${k}_safe_zone_1080x1920.png`));
  run(`[0]${ln.map(r => box(...r, '0x00E676')).join(',')},format=rgb24[c];[1]${ln.map(r => box(...r, 'white')).join(',')},format=gray[m];[c][m]alphamerge,format=rgba`,
    path.join(dir, 'png', `${k}_guide_lines_1080x1920.png`));
  console.log('built', k);
}
