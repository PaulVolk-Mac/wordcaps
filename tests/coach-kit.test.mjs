// Coach Kit product page: the demo maths equals the Excel workbook, the static HTML equals the maths,
// structured data equals the visible text, and the legal / honesty lines are present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'coach-kit');
const html = readFileSync(path.join(DIR, 'index.html'), 'utf8');
const D = createRequire(import.meta.url)(path.join(DIR, 'demo.js'));
const BUY = 'https://volkster45.gumroad.com/l/daqeao';
const PRICE = '14.99';
const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const ld = (id) => JSON.parse(html.match(new RegExp(`<script type="application/ld\\+json" id="${id}">([\\s\\S]*?)</script>`))[1]);

test('demo maths: Epley and Brzycki as in the workbook (1-10 reps only)', () => {
  // values from the workbook's own test (bauen_coach.py) and the plan screenshot: 100 kg x 5 -> 116.7, 80 % -> 92.5
  assert.equal(D.epley(100, 5), 116.7);
  assert.equal(D.brzycki(100, 5), 112.5);
  assert.equal(D.epley(100, 1), 100);
  assert.equal(D.brzycki(100, 1), 100);
  assert.equal(D.epley(60, 10), 80);
  assert.equal(D.brzycki(60, 10), 80);
  assert.equal(D.epley(72.5, 8), 91.8);
  for (const bad of [[100, 0], [100, 11], [100, 2.5], [0, 5], [-5, 5], [NaN, 5], [100, NaN], [1001, 5], ['100', 5]]) {
    assert.equal(D.epley(...bad), null, `epley(${bad})`);
    assert.equal(D.brzycki(...bad), null, `brzycki(${bad})`);
  }
});

test('demo maths: target kg is rounded to 2.5 kg like Excel MROUND', () => {
  assert.equal(D.targetKg(116.7, 80), 92.5);
  assert.equal(D.targetKg(80, 70), 55); // bench press row in the screenshot
  assert.equal(D.targetKg(100, 51.25), 52.5); // 51.25 is exactly half a step: rounds up
  assert.equal(D.targetKg(0, 80), null);
  const t = D.loadTable(116.7);
  assert.deepEqual(t.map((r) => r.percent), [50, 55, 60, 65, 70, 75, 80, 85, 90, 95]);
  for (const r of t) assert.equal((r.kg / 2.5) % 1, 0, `${r.percent} % -> ${r.kg} is not a 2.5 kg step`);
  assert.deepEqual(D.loadTable(0), []);
});

test('static HTML shows exactly what the script computes for the default 100 kg x 5 (no jump on load)', () => {
  assert.match(html, /id="kg"[^>]*value="100"/);
  assert.match(html, /id="reps"[^>]*value="5"/);
  assert.ok(html.includes(`<b id="epley">${D.fmt(D.epley(100, 5))}</b>`));
  assert.ok(html.includes(`<b id="brzycki">${D.fmt(D.brzycki(100, 5))}</b>`));
  const rows = D.loadTable(D.epley(100, 5)).map((r) => `<tr><td>${r.percent} %</td><td>${D.fmt(r.kg)}</td></tr>`).join('');
  assert.ok(html.includes(`<tbody id="loads">${rows}</tbody>`), 'static load table differs from the computed one');
});

test('buy links, price and Product JSON-LD agree', () => {
  const buys = [...html.matchAll(/<a class="btn"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(buys.length, 2);
  for (const b of buys) assert.ok(b.startsWith(BUY + '?ref='), b);
  const p = ld('ld-product');
  assert.equal(p['@type'], 'Product');
  assert.equal(p.offers.price, PRICE);
  assert.equal(p.offers.priceCurrency, 'EUR');
  assert.equal(p.offers.url, BUY);
  assert.equal([...html.matchAll(/<b>€14\.99<\/b>/g)].length, 2, 'visible price next to both buy buttons');
  assert.ok(html.match(/<meta name="description" content="([^"]+)"/)[1].includes('€14.99'));
  assert.ok(!/aggregateRating|"review"/i.test(html), 'no ratings or reviews without real ones');
});

test('FAQPage JSON-LD matches the visible questions and answers word for word', () => {
  const faq = html.slice(html.indexOf('id="faq"'));
  const visible = [...faq.matchAll(/<div><h3>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p><\/div>/g)].map((m) => [decode(m[1]), decode(m[2])]);
  const data = ld('ld-faq').mainEntity.map((q) => [q.name, q.acceptedAnswer.text]);
  assert.ok(visible.length >= 5);
  assert.deepEqual(data, visible);
});

test('honesty and legal lines: no promises, § 19 note, legal notice link, sample data marked', () => {
  const text = decode(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, ''));
  for (const must of ['§ 19 UStG', 'not coaching or medical advice', 'not a tested maximum', 'has not been test-imported', 'Sample data']) {
    assert.ok(text.includes(must), `missing: ${must}`);
  }
  assert.ok(html.includes('href="../impressum.html"'));
  for (const banned of [/guarantee/i, /best[- ]selling/i, /\b\d[\d,.]* (coaches|trainers|customers)\b/i, /only \d+ left/i, /lose weight/i, /build muscle fast/i, /trusted by/i]) {
    assert.ok(!banned.test(text), `claim without proof: ${banned}`);
  }
});

test('images exist and reserve their size (no layout shift)', () => {
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(imgs.length, 2);
  for (const tag of imgs) {
    const src = tag.match(/src="([^"]+)"/)[1];
    assert.ok(existsSync(path.join(DIR, src)), `${src} missing`);
    assert.match(tag, /width="\d+"/);
    assert.match(tag, /height="\d+"/);
    assert.ok((tag.match(/alt="([^"]*)"/) || [])[1]?.length > 20, `${src}: alt text`);
  }
  assert.ok(existsSync(path.join(DIR, 'og.jpg')));
  assert.match(html, /<div class="theme" role="group"/, 'theme switcher is in the HTML, not injected');
});
