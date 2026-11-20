// SEO/indexability regression test: every sitemap URL must be a crawlable,
// self-canonical page with a unique title + description, exactly one <h1>,
// and be reachable from the home page through plain <a href> links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://paulvolk-mac.github.io/wordcaps/';
const MAX_DEPTH = 2; // clicks from the home page

const sitemap = readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

function fileFor(url) {
  const rel = url.slice(BASE.length);
  if (rel === '' || rel.endsWith('/')) return path.join(ROOT, rel, 'index.html');
  return path.join(ROOT, rel);
}
function normalise(url) {
  const u = new URL(url);
  u.hash = '';
  u.search = '';
  let s = u.href;
  if (s.endsWith('/index.html')) s = s.slice(0, -'index.html'.length);
  return s;
}
const pick = (html, re) => (html.match(re) || [])[1]?.trim();
const pages = new Map();
for (const url of urls) {
  const file = fileFor(url);
  const html = existsSync(file) ? readFileSync(file, 'utf8') : null;
  pages.set(url, { file, html });
}
function linksOf(url, html) {
  const out = new Set();
  const body = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of body.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const href = m[1];
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    try {
      const abs = normalise(new URL(href, url).href);
      if (abs.startsWith(BASE)) out.add(abs);
    } catch { /* ignore malformed */ }
  }
  return out;
}

test('sitemap lists pages', () => {
  assert.ok(urls.length >= 20, `only ${urls.length} URLs in sitemap.xml`);
  assert.equal(new Set(urls).size, urls.length, 'duplicate <loc> in sitemap.xml');
});

test('every sitemap URL is an indexable, self-canonical page', () => {
  const problems = [];
  for (const [url, { html }] of pages) {
    if (!html) { problems.push(`${url}: file missing`); continue; }
    if (/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html)) problems.push(`${url}: noindex`);
    const canon = pick(html, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
      ?? pick(html, /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
    if (canon !== url) problems.push(`${url}: canonical is ${canon ?? 'missing'}`);
    if (!/<html[^>]+lang=["'][a-z]{2}/i.test(html)) problems.push(`${url}: <html lang> missing`);
    const h1 = (html.replace(/<!--[\s\S]*?-->/g, '').match(/<h1[\s>]/gi) || []).length;
    if (h1 !== 1) problems.push(`${url}: ${h1} <h1> elements`);
    if (!/<meta[^>]+name=["']viewport["']/i.test(html)) problems.push(`${url}: viewport missing`);
  }
  assert.deepEqual(problems, []);
});

test('titles and descriptions are present, unique and a sane length', () => {
  const problems = [];
  const titles = new Map();
  const descs = new Map();
  for (const [url, { html }] of pages) {
    if (!html) continue;
    const title = pick(html, /<title>([\s\S]*?)<\/title>/i);
    const desc = pick(html, /<meta[^>]+name=["']description["'][^>]*content="([^"]*)"/i)
      ?? pick(html, /<meta[^>]+name=["']description["'][^>]*content='([^']*)'/i);
    if (!title) problems.push(`${url}: title missing`);
    else {
      if (title.length < 15 || title.length > 70) problems.push(`${url}: title length ${title.length}`);
      if (titles.has(title)) problems.push(`${url}: same title as ${titles.get(title)}`);
      titles.set(title, url);
    }
    if (!desc) problems.push(`${url}: description missing`);
    else {
      if (desc.length < 70 || desc.length > 170) problems.push(`${url}: description length ${desc.length}`);
      if (descs.has(desc)) problems.push(`${url}: same description as ${descs.get(desc)}`);
      descs.set(desc, url);
    }
  }
  assert.deepEqual(problems, []);
});

test(`every sitemap URL is reachable from the home page within ${MAX_DEPTH} clicks`, () => {
  const depth = new Map([[BASE, 0]]);
  const queue = [BASE];
  while (queue.length) {
    const cur = queue.shift();
    const page = pages.get(cur);
    if (!page?.html) continue;
    for (const next of linksOf(cur, page.html)) {
      if (!depth.has(next)) { depth.set(next, depth.get(cur) + 1); queue.push(next); }
    }
  }
  const problems = urls
    .filter((u) => !depth.has(u) || depth.get(u) > MAX_DEPTH)
    .map((u) => `${u}: ${depth.has(u) ? `depth ${depth.get(u)}` : 'not linked (orphan)'}`);
  assert.deepEqual(problems, []);
});

test('every sitemap URL has at least 2 internal pages linking to it', () => {
  const inbound = new Map(urls.map((u) => [u, new Set()]));
  for (const [url, { html }] of pages) {
    if (!html) continue;
    for (const target of linksOf(url, html)) {
      if (target !== url && inbound.has(target)) inbound.get(target).add(url);
    }
  }
  const problems = [...inbound].filter(([u, s]) => u !== BASE && s.size < 2)
    .map(([u, s]) => `${u}: ${s.size} inbound`);
  assert.deepEqual(problems, []);
});

test('no internal link points to a page that does not exist', () => {
  const problems = [];
  for (const [url, { html }] of pages) {
    if (!html) continue;
    for (const target of linksOf(url, html)) {
      const f = fileFor(target);
      if (!existsSync(f)) problems.push(`${url} -> ${target}`);
    }
  }
  assert.deepEqual(problems, []);
});
