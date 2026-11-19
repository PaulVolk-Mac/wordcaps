#!/usr/bin/env node
// Builds the static tool overview list (tools/index.html) and the
// "More free tools" block on every tool page from tools/tools.json.
// The HTML stays static (crawlable links, works without JavaScript).
//
//   node scripts/build-tools.mjs          write the generated regions
//   node scripts/build-tools.mjs --check  exit 1 if a page is out of date
//
// No dependencies. Tests: node --test
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOTE = 'generated from tools/tools.json by scripts/build-tools.mjs - do not edit by hand';
export const MARK = {
  list: [`<!-- tools-list:start (${NOTE}) -->`, '<!-- tools-list:end -->'],
  related: [`<!-- related-tools:start (${NOTE}) -->`, '<!-- related-tools:end -->'],
};

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function loadData(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'tools', 'tools.json'), 'utf8'));
}

export const liveTools = (data) => data.tools.filter((t) => t.status === 'live');

const icon = (t) => `<span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg></span>`;

/** Overview: filter bar (hidden until the script runs) + static list + ItemList JSON-LD. */
export function renderList(data) {
  const live = liveTools(data);
  const label = Object.fromEntries(data.categories.map((c) => [c.id, c.label]));
  const chips = [['all', 'All'], ...data.categories.map((c) => [c.id, c.label])]
    .map(([id, text]) => `<button type="button" data-cat="${esc(id)}" aria-pressed="${id === 'all'}">${esc(text)}</button>`)
    .join('');
  const items = live.map((t) => {
    const cats = t.categories.map((c) => label[c]);
    const search = [t.name, t.desc, ...t.keywords, ...cats].join(' ').toLowerCase();
    return (
      `<li data-cats="${esc(t.categories.join(' '))}" data-search="${esc(search)}">` +
      `<a class="tool" href="${esc(t.slug)}/">${icon(t)}` +
      `<span class="tx"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span>` +
      `<span class="cat">${esc(cats.join(' · '))}</span></span>` +
      `<span class="go" aria-hidden="true">→</span></a></li>`
    );
  });
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Free tools',
    itemListElement: live.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      url: `${data.base}${t.slug}/`,
    })),
  };
  return [
    `<div class="filter" id="tfilter" hidden>`,
    `<label class="sr" for="tq">Search tools</label>`,
    `<input type="search" id="tq" placeholder="Search tools, e.g. subtitles, timer, noise" autocomplete="off" spellcheck="false">`,
    `<div class="chips" role="group" aria-label="Category">${chips}</div>`,
    `</div>`,
    `<p class="stat" id="tstat" role="status" aria-live="polite"></p>`,
    `<ul class="tools" id="tlist">`,
    ...items,
    `</ul>`,
    `<p class="empty" id="tempty" hidden>No tool matches. <button type="button" id="tclear">Show all tools</button></p>`,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
  ].join('\n');
}

const REL_CSS =
  '.rel{max-width:1040px;margin:0 auto;padding:0 20px 26px}' +
  '.rel h2{font-size:17px;font-weight:650;letter-spacing:-.01em;margin:0 0 10px;color:var(--fg)}' +
  '.rel ul{list-style:none;margin:0;padding:0;display:grid;gap:10px;grid-template-columns:repeat(3,minmax(0,1fr))}' +
  '.rel li a{display:flex;gap:12px;align-items:center;height:100%;min-height:64px;padding:12px 14px;background:var(--panel);border:1px solid var(--line);border-radius:14px;color:var(--fg);text-decoration:none;transition:border-color .15s}' +
  '.rel li a:hover{border-color:var(--line2)}' +
  '.rel a:focus-visible{outline:2px solid var(--acc);outline-offset:2px}' +
  '.rel .ic{flex:none;width:36px;height:36px;border-radius:10px;background:var(--soft);display:grid;place-items:center}' +
  '.rel .ic svg{width:18px;height:18px;stroke:var(--fg);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}' +
  '.rel b{display:block;font-weight:600;font-size:14.5px;line-height:1.3}' +
  '.rel li span span{display:block;color:var(--mut);font-size:13px;line-height:1.4;margin-top:2px}' +
  '.rel .all{margin:12px 0 0;font-size:14px}' +
  '.rel .all a{display:inline-block;padding:10px 0;color:var(--fg);font-weight:600}' +
  '@media(max-width:820px){.rel ul{grid-template-columns:1fr}}' +
  '@media print{.rel{display:none}}';

/** Tool page: three related tools + link to the overview. */
export function renderRelated(data, tool) {
  const bySlug = Object.fromEntries(liveTools(data).map((t) => [t.slug, t]));
  const items = tool.related.map((slug) => {
    const t = bySlug[slug];
    if (!t) throw new Error(`${tool.slug}: related tool "${slug}" is missing or not live`);
    return `<li><a href="../${esc(t.slug)}/">${icon(t)}<span><b>${esc(t.name)}</b><span>${esc(t.tagline)}</span></span></a></li>`;
  });
  return [
    `<style>${REL_CSS}</style>`,
    `<nav class="rel" aria-labelledby="rel-h">`,
    `<h2 id="rel-h">More free tools</h2>`,
    `<ul>`,
    ...items,
    `</ul>`,
    `<p class="all"><a href="../">All free tools →</a></p>`,
    `</nav>`,
  ].join('\n');
}

/** Replace the region between the markers; insert before `anchor` when the markers are missing. */
export function putRegion(html, [start, end], body, anchor) {
  const block = `${start}\n${body}\n${end}`;
  const a = html.indexOf(start.slice(0, start.indexOf(' (')));
  if (a !== -1) {
    const b = html.indexOf(end, a);
    if (b === -1) throw new Error(`end marker missing: ${end}`);
    return html.slice(0, a) + block + html.slice(b + end.length);
  }
  const at = html.indexOf(anchor);
  if (at === -1) throw new Error(`anchor not found: ${anchor}`);
  return html.slice(0, at) + block + '\n' + html.slice(at);
}

/** Returns [{file, current, next}] for every page that carries a generated region. */
export function plan(root = ROOT) {
  const data = loadData(root);
  const out = [];
  const add = (file, fn) => {
    if (!existsSync(file)) throw new Error(`page missing: ${file}`);
    const raw = readFileSync(file, 'utf8');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const next = fn(raw.replace(/\r\n/g, '\n')).replace(/\n/g, eol);
    out.push({ file, current: raw, next });
  };
  add(join(root, 'tools', 'index.html'), (h) => putRegion(h, MARK.list, renderList(data), '<ul class="tools">'));
  for (const t of liveTools(data)) {
    add(join(root, 'tools', t.slug, 'index.html'), (h) => putRegion(h, MARK.related, renderRelated(data, t), '<footer'));
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  const stale = plan().filter((p) => p.current !== p.next);
  if (check) {
    for (const p of stale) console.error(`out of date: ${p.file}`);
    console.log(stale.length ? `${stale.length} page(s) out of date - run: node scripts/build-tools.mjs` : 'all pages up to date');
    process.exit(stale.length ? 1 : 0);
  }
  for (const p of stale) writeFileSync(p.file, p.next);
  console.log(`${stale.length} page(s) written`);
}
