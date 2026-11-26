// Static checks for the v2 page draft (browser edition). Run: node --test seite.test.mjs
// The page may only claim what the app really does. The checks against the app source (core.js, app.js, packaging script) live in the product folder, not in this repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'coach-kit');
const html = readFileSync(path.join(DIR, 'index.html'), 'utf8');
const require = createRequire(import.meta.url);
const D = require(path.join(DIR, 'demo.js'));
const BUY = 'https://volkster45.gumroad.com/l/daqeao';
const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const ld = (id) => JSON.parse(html.match(new RegExp(`<script type="application/ld\\+json" id="${id}">([\\s\\S]*?)</script>`))[1]);

test('head: title, description, canonical, one h1', () => {
  const title = html.match(/<title>([^<]+)<\/title>/)[1];
  assert.ok(title.length <= 65 && title.includes('Personal Trainers'), title);
  const desc = html.match(/<meta name="description" content="([^"]+)"/)[1];
  assert.ok(desc.length >= 120 && desc.length <= 170, `description ${desc.length}`);
  assert.ok(desc.includes('€14.99'));
  assert.match(html, /<link rel="canonical" href="https:\/\/paulvolk-mac\.github\.io\/wordcaps\/coach-kit\/">/);
  assert.equal([...html.matchAll(/<h1[ >]/g)].length, 1);
  assert.ok(!/noindex/i.test(html));
});

test('static demo values equal the computed ones (Epley only, like the app)', () => {
  assert.ok(html.includes(`<b id="epley">${D.fmt(D.epley(100, 5))}</b>`));
  const rows = D.loadTable(D.epley(100, 5)).map((r) => `<tr><td>${r.percent} %</td><td>${D.fmt(r.kg)}</td></tr>`).join('');
  assert.ok(html.includes(`<tbody id="loads">${rows}</tbody>`), 'static load table differs from the computed one');
  assert.ok(!/brzycki/i.test(html), 'the app only uses Epley – the page must not show Brzycki');
  assert.equal(D.targetKg(116.7, 80), 92.5); // squat row in the screenshot alt text
});

test('price, buy links and Product data agree', () => {
  const buys = [...html.matchAll(/<a class="btn" id="buy-(?:top|bottom)" href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(buys.length, 2);
  for (const b of buys) assert.ok(b.startsWith(BUY + '?ref='), b);
  const p = ld('ld-product');
  assert.equal(p['@type'], 'Product');
  assert.equal(p.offers.price, '14.99');
  assert.equal(p.offers.priceCurrency, 'EUR');
  assert.equal(p.offers.url, BUY);
  assert.equal([...html.matchAll(/<b>€14\.99<\/b>/g)].length, 2);
  assert.ok(!/aggregateRating|"review"/i.test(html), 'no ratings or reviews without real ones');
});

test('FAQ data equals the visible FAQ', () => {
  const data = ld('ld-faq').mainEntity.map((q) => [q.name, q.acceptedAnswer.text]);
  const block = html.match(/<div class="faq" id="faq">([\s\S]*?)\n<\/div>/)[1];
  const visible = [...block.matchAll(/<h3>([^<]+)<\/h3><p>([^<]+)<\/p>/g)]
    .map((m) => [m[1], m[2]].map((s) => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')));
  assert.ok(visible.length >= 6);
  assert.deepEqual(data, visible);
});

test('claims match the app (limits, rules, package content)', () => {
  assert.ok(text.includes('Up to 60 rows per plan'));
  assert.ok(text.includes('14 days or more without a log entry'));
  assert.ok(text.includes('in no backup file for 7 days'));
  assert.ok(text.includes('double-click CoachKit.html'));
  assert.ok(text.includes('Excel version as an extra'));
  for (const knopf of ['Load sample data', 'Save backup file']) { assert.ok(text.includes(knopf), knopf); }
});

test('honest limits are on the page, unproven claims are not', () => {
  for (const must of ['Please read before you buy', 'There is no sync', 'clearing the browser data deletes', 'Firefox and Safari (including iPhone) were not tested',
    'tested in Microsoft Edge and Google Chrome on Windows', 'not a tested maximum', 'A logo upload is not included',
    'not coaching or medical advice', 'Gumroad calculates and remits VAT', 'Sample data', 'made up']) {
    assert.ok(text.includes(must), `missing: ${must}`);
  }
  assert.ok(html.includes('href="../impressum.html"'));
  for (const banned of [/\b(best (?:app|tool|template|software)|#1|guaranteed|proven|scientifically|trusted by|thousands of|limited time|only \d+ left)\b/i,
    /works in (all|every) browsers?/i, /\bsync(s|ed)? (across|between)\b/i, /\bmacro-free app\b/i, /\bcloud backup\b/i, /GDPR[- ]compliant/i]) {
    assert.ok(!banned.test(text), `claim without proof: ${banned}`);
  }
  assert.ok(!/Excel kit for (coaches|personal trainers)/i.test(text), 'the lead must describe the browser app, not the Excel kit');
});

test('images exist, have sizes and alt text', () => {
  const imgs = [...html.matchAll(/<img [^>]+>/g)].map((m) => m[0]);
  assert.equal(imgs.length, 4);
  for (const tag of imgs) {
    const src = tag.match(/src="([^"]+)"/)[1];
    assert.ok(existsSync(path.join(DIR, src)), `${src} missing`);
    assert.match(tag, /width="\d+"/);
    assert.match(tag, /height="\d+"/);
    assert.ok((tag.match(/alt="([^"]*)"/) || [])[1]?.length > 20, `${src}: alt text`);
  }
  assert.ok(existsSync(path.join(DIR, 'og.jpg')));
  assert.match(html, /<div class="theme" role="group"/);
});

test('progress sheet and templates: page text and screenshot', () => {
  assert.ok(text.includes('first, best and latest estimated 1RM per exercise'));
  assert.ok(text.includes('two starting templates (2 and 4 days)'));
  assert.ok(existsSync(path.join(DIR, 'app-progress.webp')));
  const m = html.match(/<img src="app-progress\.webp" width="1180" height="(\d+)"/);
  assert.equal(m[1], '620');
});

// A-477 / J-226 (FernUSG) + J-224: runs on both public pages, English and German
const PAGES = { en: html, de: readFileSync(path.join(DIR, 'de', 'index.html'), 'utf8') };

test('no draft placeholder is left on a public page', () => {
  for (const [lang, h] of Object.entries(PAGES)) {
    assert.ok(!/PLACEHOLDER|PLATZHALTER|LIVE BLOCK|LIVE-SPERRE|data-live-sperre|-placeholder/i.test(h), `${lang}: draft placeholder`);
  }
});

test('FernUSG: required sentence is there, forbidden words are not', () => {
  assert.ok(PAGES.de.includes('Gebaut von mir, Paul Volk. Ein Werkzeug für Trainer, kein Coaching durch mich.'), 'de: sentence missing');
  assert.ok(PAGES.en.includes('Built by me, Paul Volk. A tool for trainers, not coaching by me.'), 'en: sentence missing');
  for (const [lang, h] of Object.entries(PAGES)) {
    const hit = h.match(/coaching[\s-]?programm?|ausbildung|betreuung|zertifi[kz]|certifi(?:cate|cation|ed)/i);
    assert.ok(!hit, `${lang}: forbidden word ${hit && hit[0]}`);
  }
});

test('return policy and tax line: 14 days money back, Gumroad handles VAT, no small-business VAT claim', () => {
  assert.match(PAGES.de, /<section id="returns"[\s\S]*14 Tage Geld zurück[\s\S]*Widerrufsrecht[\s\S]*<\/section>/);
  assert.match(PAGES.en, /<section id="returns"[\s\S]*14-day money back[\s\S]*right of withdrawal[\s\S]*<\/section>/);
  assert.ok(PAGES.de.includes('Gumroad berechnet und führt die Umsatzsteuer ab'));
  assert.ok(PAGES.en.includes('Gumroad calculates and remits VAT'));
  for (const [lang, h] of Object.entries(PAGES)) {
    assert.ok(!/§ ?19/.test(h), `${lang}: old § 19 sentence`);
    assert.ok(h.includes('href="mailto:kontakt@excelbrief.de"'), `${lang}: contact address from the legal notice`);
  }
});
