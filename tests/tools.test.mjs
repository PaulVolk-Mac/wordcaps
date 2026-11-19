// node --test
// Checks tools/tools.json against the pages that really exist, the generated
// regions, and every internal link of the site (no dead links, no link to a
// tool that is not live).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { ROOT, MARK, loadData, liveTools, plan, renderList, renderRelated, putRegion, esc } from '../scripts/build-tools.mjs';

const data = loadData();
const live = liveTools(data);
const SITE = 'https://paulvolk-mac.github.io/wordcaps/';
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

function htmlFiles(dir = ROOT) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlFiles(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** Local file a link points to, or null for external / in-page / data links. */
function target(file, href) {
  let h = href.trim().replace(/&amp;/g, '&');
  if (h.startsWith(SITE)) h = '/' + h.slice(SITE.length);
  else if (/^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith('//') || h.startsWith('#')) return null;
  h = h.split('#')[0].split('?')[0];
  if (h === '') return null;
  let p = h.startsWith('/') ? join(ROOT, h) : join(dirname(file), h);
  if (h.endsWith('/') || (existsSync(p) && statSync(p).isDirectory())) p = join(p, 'index.html');
  return p;
}

const links = (html) => [...html.matchAll(/\s(?:href|src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => m[1] ?? m[2]);
const stripCode = (html) => html.replace(/<script\b(?![^>]*\bsrc=)[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');

test('tools.json: every live tool has a page, every tool page is in tools.json', () => {
  const dirs = readdirSync(join(ROOT, 'tools'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, 'tools', e.name, 'index.html')))
    .map((e) => e.name)
    .sort();
  assert.deepEqual(live.map((t) => t.slug).sort(), dirs);
});

test('tools.json: fields, categories and related tools are valid', () => {
  const cats = data.categories.map((c) => c.id);
  const slugs = live.map((t) => t.slug);
  assert.equal(new Set(data.tools.map((t) => t.slug)).size, data.tools.length, 'slugs are unique');
  for (const t of data.tools) {
    for (const k of ['slug', 'status', 'name', 'desc', 'tagline', 'icon']) assert.ok(t[k], `${t.slug}: ${k}`);
    assert.ok(t.categories.length >= 1 && t.categories.every((c) => cats.includes(c)), `${t.slug}: categories`);
    assert.ok(t.tagline.length <= 60, `${t.slug}: tagline max 60 characters`);
  }
  for (const t of live) {
    assert.equal(t.related.length, 3, `${t.slug}: exactly 3 related tools`);
    assert.equal(new Set(t.related).size, 3, `${t.slug}: related tools are distinct`);
    assert.ok(!t.related.includes(t.slug), `${t.slug}: does not link to itself`);
    for (const r of t.related) assert.ok(slugs.includes(r), `${t.slug}: related "${r}" is live`);
  }
  for (const c of cats) assert.ok(live.some((t) => t.categories.includes(c)), `category "${c}" has a live tool`);
  for (const s of slugs) assert.ok(live.some((t) => t.related.includes(s)), `"${s}" is linked from another tool`);
});

test('generated regions are up to date (node scripts/build-tools.mjs)', () => {
  const stale = plan().filter((p) => p.current !== p.next).map((p) => relative(ROOT, p.file));
  assert.deepEqual(stale, []);
});

test('overview: one static link per live tool, filter data matches tools.json', () => {
  const html = read('tools', 'index.html');
  const items = [...html.matchAll(/<li data-cats="([^"]*)" data-search="([^"]*)"><a class="tool" href="([^"]*)"/g)];
  assert.deepEqual(items.map((m) => m[3]), live.map((t) => `${t.slug}/`));
  items.forEach((m, i) => {
    assert.equal(m[1], live[i].categories.join(' '));
    assert.ok(m[2].includes(esc(live[i].name.toLowerCase())), 'search text contains the name');
  });
  const chips = [...html.matchAll(/<button type="button" data-cat="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(chips, ['all', ...data.categories.map((c) => c.id)]);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(ld.itemListElement.map((e) => e.url), live.map((t) => `${data.base}${t.slug}/`));
  assert.match(html, /<label class="sr" for="tq">/);
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  for (const sel of ['.sr{', '#tq{', '.chips button{', '.chips button[aria-pressed=true]{', 'ul.tools li[hidden]{display:none}', '.empty{'])
    assert.ok(css.replace(/,\.empty button/g, '').includes(sel) || css.includes(sel), `styles for ${sel} are present`);
});

test('overview: filter script finds the right tools and never rewrites the address', () => {
  const html = read('tools', 'index.html');
  const src = html.match(/<script data-tools-filter>([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(src, /history\.|location\.(href|assign|replace)\s*[=(]/, 'visitor counter must not count twice');
  // Minimal DOM stand-in: enough to run the real script from the page.
  const el = (o = {}) => ({ hidden: false, dataset: {}, attrs: {}, on: {}, value: '', textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, f) { this.on[k] = f; }, focus() {}, ...o });
  const items = [...html.matchAll(/<li data-cats="([^"]*)" data-search="([^"]*)"><a class="tool" href="([^"]*)\/"/g)]
    .map((m) => el({ dataset: { cats: m[1], search: m[2].replace(/&amp;/g, '&') }, slug: m[3] }));
  const chips = ['all', ...data.categories.map((c) => c.id)].map((c) => el({ dataset: { cat: c } }));
  const bar = el({ hidden: true, querySelectorAll: () => chips });
  const ids = { tfilter: bar, tq: el(), tstat: el(), tempty: el({ hidden: true }), tclear: el() };
  const boot = (search) => {
    ids.tq.value = '';
    new Function('document', 'location', src)(
      { getElementById: (id) => ids[id], querySelectorAll: () => items }, { search });
  };
  const shown = () => items.filter((i) => !i.hidden).map((i) => i.slug);
  const type = (v) => { ids.tq.value = v; ids.tq.on.input(); };
  const chip = (c) => chips.find((b) => b.dataset.cat === c).on.click();

  boot('');
  assert.equal(bar.hidden, false, 'filter bar appears once the script runs');
  assert.equal(shown().length, live.length);
  for (const c of data.categories)
    { chip(c.id); assert.deepEqual(shown(), live.filter((t) => t.categories.includes(c.id)).map((t) => t.slug), c.id); }
  chip('all');
  type('srt'); assert.deepEqual(shown(), ['subtitle-converter']);
  type('  SLEEP   timer '); assert.deepEqual(shown(), ['noise-machine']);
  type('tabata'); assert.deepEqual(shown(), ['hiit-timer']);
  type('nightcore'); chip('video');
  assert.deepEqual(shown(), []); assert.equal(ids.tempty.hidden, false); assert.equal(ids.tstat.textContent, `0 of ${live.length} tools`);
  ids.tclear.on.click();
  assert.equal(shown().length, live.length); assert.equal(ids.tempty.hidden, true);
  assert.equal(chips[0].attrs['aria-pressed'], 'true');
  boot('?cat=audio&q=reverb'); assert.deepEqual(shown(), ['slowed-reverb']);
  boot('?cat=nonsense'); assert.equal(shown().length, live.length);
});

test('tool pages: block with exactly the 3 related tools, between </main> and <footer>', () => {
  for (const t of live) {
    const html = read('tools', t.slug, 'index.html').replace(/\r\n/g, '\n');
    const a = html.indexOf('<!-- related-tools:start');
    const b = html.indexOf(MARK.related[1]);
    assert.ok(a > html.indexOf('</main>') && b > a && b < html.indexOf('<footer'), `${t.slug}: position`);
    const hrefs = [...html.slice(a, b).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, [...t.related.map((r) => `../${r}/`), '../'], t.slug);
    assert.equal(html.split('<!-- related-tools:start').length, 2, `${t.slug}: block exists once`);
  }
});

test('build helpers: escaping, idempotent regions, unknown related tool fails', () => {
  assert.equal(esc('A & B <"x">'), 'A &amp; B &lt;&quot;x&quot;&gt;');
  assert.ok(renderList(data).includes('HIIT &amp; Tabata Timer'));
  const once = putRegion('<main></main>\n<footer>x</footer>', MARK.related, 'BODY', '<footer');
  assert.equal(putRegion(once, MARK.related, 'BODY', '<footer'), once);
  assert.ok(once.indexOf('BODY') < once.indexOf('<footer'));
  assert.throws(() => renderRelated(data, { slug: 'x', related: ['protein-cost-calculator'] }), /missing or not live/);
});

test('link checker: no dead internal links, tool links only to live tools', () => {
  const liveDirs = new Set(live.map((t) => join(ROOT, 'tools', t.slug, 'index.html')));
  const dead = [];
  let checked = 0;
  for (const file of htmlFiles()) {
    for (const href of links(stripCode(readFileSync(file, 'utf8')))) {
      const p = target(file, href);
      if (!p) continue;
      checked++;
      const rel = relative(ROOT, p).split(sep);
      if (!existsSync(p)) dead.push(`${relative(ROOT, file)} -> ${href}`);
      else if (rel[0] === 'tools' && rel.length === 3 && rel[2] === 'index.html' && !liveDirs.has(p))
        dead.push(`${relative(ROOT, file)} -> ${href} (tool is not live)`);
    }
  }
  assert.ok(checked > 100, `only ${checked} links checked`);
  assert.deepEqual(dead, []);
});

test('tool pages: theme switcher is in the HTML header, not injected later (CLS, A-217)', () => {
  for (const t of live) {
    const html = read('tools', t.slug, 'index.html');
    const head = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    assert.match(head, /<div class="theme" role="group" aria-label="Appearance">/, `${t.slug}: static .theme missing in <header>`);
    for (const m of ['auto', 'light', 'dark']) assert.ok(head.includes(`data-t="${m}"`), `${t.slug}: button ${m} missing`);
    assert.equal((html.match(/class="theme"/g) || []).length, 1, `${t.slug}: exactly one .theme`);
    assert.ok(html.includes('var g=h.querySelector(".theme");if(!g)'), `${t.slug}: script must reuse the static switcher`);
  }
});

test('safe zone checker: platform tabs are in the HTML from the start (CLS, A-217)', () => {
  const html = read('tools', 'safe-zone-checker', 'index.html');
  const m = html.match(/<div class="seg" id="tabs"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(m, 'tabs container missing');
  for (const p of ['tiktok', 'reels', 'shorts', 'combined']) assert.ok(m[1].includes(`data-p="${p}"`), `tab ${p} missing`);
  assert.match(m[1], /data-p="combined" role="radio" aria-checked="true" class="on"/, 'default tab must match cur=combined');
});

// Lighthouse 19.11.: --dim #8f8f98 had 4.03:1 on the dark tile (#3a2f2b) and 4.41:1 on #2b2b2b (WCAG AA needs 4.5:1).
function lum(hex) {
  const c = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('a11y: dark --dim text reaches 4.5:1 on every dark surface of every tool page', () => {
  const pages = ['tools/index.html', ...readdirSync(join(ROOT, 'tools'), { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(ROOT, 'tools', e.name, 'index.html')))
    .map(e => `tools/${e.name}/index.html`)];
  for (const p of pages) {
    const dims = [...read(p).matchAll(/color-scheme:dark;[^}]*?--dim:#([0-9a-fA-F]{6})/g)].map(m => m[1]);
    for (const d of dims) for (const bg of ['3a2f2b', '2b2b2b', '262626', '1c1c1c'])
      assert.ok(ratio(d, bg) >= 4.5, `${p}: --dim #${d} on #${bg} = ${ratio(d, bg).toFixed(2)}:1`);
  }
});

test('a11y: safe zone checker – every button with aria-checked has role="radio"', () => {
  const html = read('tools', 'safe-zone-checker', 'index.html');
  for (const m of html.matchAll(/<button\b[^>]*aria-checked[^>]*>/g))
    assert.match(m[0], /role="radio"/, m[0]);
});
