// Legal notice (Impressum): page exists, is linked from every page, stays out of the sitemap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pages = [
  ...readdirSync(root).filter((f) => f.endsWith('.html') && !f.startsWith('google')).map((f) => [f, '']),
  ['tools/index.html', '../'],
  ['coach-kit/index.html', '../'],
  ...readdirSync(join(root, 'tools'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, 'tools', d.name, 'index.html')))
    .map((d) => [`tools/${d.name}/index.html`, '../../']),
];

test('impressum.html exists with the required sections and noindex', () => {
  const h = readFileSync(join(root, 'impressum.html'), 'utf8');
  for (const part of ['§ 5 DDG', 'Kontakt', '§ 19 UStG', '§ 18 Abs. 2 MStV', '<meta name="robots" content="noindex">']) {
    assert.ok(h.includes(part), `missing: ${part}`);
  }
});

test('every page links to the legal notice with a working relative path', () => {
  assert.ok(pages.length >= 26, `only ${pages.length} pages found`);
  for (const [file, prefix] of pages) {
    const h = readFileSync(join(root, file), 'utf8');
    assert.ok(h.includes(`href="${prefix}impressum.html"`), `${file}: no link to ${prefix}impressum.html`);
    assert.ok(existsSync(join(root, dirname(file), prefix, 'impressum.html')), `${file}: link target missing`);
  }
});

test('legal notice is not listed in sitemap.xml', () => {
  assert.ok(!readFileSync(join(root, 'sitemap.xml'), 'utf8').includes('impressum.html'));
});

test('impressum.html has no unfilled [[...]] placeholder or TODO left', () => {
  const h = readFileSync(join(root, 'impressum.html'), 'utf8');
  assert.ok(!/\[\[[^\]]*\]\]/.test(h), 'placeholder left in impressum.html');
  assert.ok(!h.includes('TODO'), 'TODO left in impressum.html');
  assert.ok(/href="mailto:[^"@]+@[^"]+"/.test(h), 'no contact e-mail link');
});
