import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as yaml from 'js-yaml';
import { buildTitleFilter } from '../title-keywords.mjs';
import { buildEmploymentFilter, validateEmploymentFilter } from '../employment-filter.mjs';
import { buildContentFilter, buildLocationFilter, matchedTitleKeywords } from '../scan.mjs';
import { checkFranceConfig } from '../france-culture.mjs';
import { normalizeWttjHit } from '../providers/wttj.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FILE = join(ROOT, 'config/france-nonacademic/portals.yml');
const config = yaml.load(readFileSync(FILE, 'utf8'));
const cases = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/france-culture-jobs.json'), 'utf8'));

for (const [title, expected] of cases.titles) {
  test(`French/English title ${expected ? 'keeps' : 'rejects'}: ${title}`, () => {
    assert.equal(buildTitleFilter(config.title_filter)(title), expected);
  });
}
for (const { name, job, ...expected } of cases.employment) {
  test(`employment: ${name}`, () => {
    const actual = buildEmploymentFilter(config.employment_filter)(job);
    for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], value, key);
  });
}

test('an absent employment block preserves previous scanner behavior', () => {
  assert.equal(buildEmploymentFilter(undefined)({ title: 'Unpaid role' }), null);
});
test('French profile has no inherited AI/ML positive filter and keeps alias in Enssib', () => {
  assert.equal(config.job_boards[0].enssib.title_filter, config.title_filter);
  assert.equal(config.visa_filter.enabled, false);
  assert.equal(config.salary_filter, undefined);
  assert.equal(config.title_filter_full, undefined);
});
test('known unrelated project context is rejected; missing JD is kept', () => {
  const f = buildContentFilter(config.content_filter);
  const keywords = matchedTitleKeywords('Cheffe de projet numérique', config.title_filter);
  assert.equal(f('Projet de numérisation des collections du musée.', keywords), true);
  assert.equal(f('Campagnes publicitaires pour boutiques e-commerce.', keywords), false);
  assert.equal(f('', keywords), true);
});
test('native location gate keeps France, remote, unknown and smaller city names', () => {
  const f = buildLocationFilter(config.location_filter);
  for (const location of ['Lyon, France', 'France', 'Remote', 'Télétravail', 'Cachan', 'Veyras', '']) assert.equal(f(location), true, location);
});
test('employment schema rejects typo/invalid settings', () => {
  for (const cfg of [null, { signals: [] }, { reject_explicit_unpaid: 'true', signals: {} }, { signals: { paid: 42 } }, { signals: { unknow: ['x'] } }]) {
    assert.ok(validateEmploymentFilter(cfg).length > 0);
  }
});
test('France-scoped WTTJ searches retain a French office beyond the first', () => {
  const hit = { name: 'Data steward', slug: 'data', organization: { name: 'Fixture', slug: 'fixture' },
    offices: [{ city: 'Berlin', country: 'Germany' }, { city: 'Lyon', country: 'France' }] };
  assert.equal(normalizeWttjHit(hit).location, 'Berlin, Germany', 'legacy behavior unchanged');
  const job = normalizeWttjHit(hit, { includeAllOffices: true });
  assert.match(job.location, /Lyon, France/);
  assert.equal(buildLocationFilter(config.location_filter)(job.location), true);
});
test('offline preflight claims every enabled board and labels unsupported sources', async () => {
  const report = await checkFranceConfig(FILE);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.sources.filter(s => s.enabled).length, 3);
  assert.equal(report.sources.filter(s => !s.enabled && !s.provider).length, 6);
});
test('offline scan uses the actual configured gates and exports unknown states', () => {
  const temp = mkdtempSync(join(tmpdir(), 'career-france-'));
  try {
    const fixtureConfig = { ...config, tracked_companies: [], job_boards: [{
      name: 'French synthetic fixtures', provider: 'local-parser', aggregator: true,
      parser: { command: 'node', script: 'tests/fixtures/france-culture-parser.mjs' }
    }] };
    const portals = join(temp, 'portals.yml');
    writeFileSync(portals, yaml.dump(fixtureConfig));
    const result = spawnSync(process.execPath, [join(ROOT, 'france-culture.mjs'), '--scan', '--file', portals, '--dry-run', '--json'], {
      cwd: ROOT, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, CAREER_OPS_ROOT: temp, CAREER_OPS_DATA_DIR: temp },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.found, 5);
    assert.equal(receipt.added, 2);
    assert.equal(receipt.filtered, 3);
    assert.equal(receipt.employment.rejected, 2);
    assert.deepEqual(receipt.added_urls.sort(), ['https://example.org/jobs/1', 'https://example.org/jobs/5']);
    for (const offer of receipt.employment.offers) {
      assert.equal(offer.payment, 'unknown');
      assert.equal(offer.sponsorship, 'unknown');
    }
    assert.equal(existsSync(join(temp, 'data/france-nonacademic/data/pipeline.md')), false, 'dry run writes no pipeline');
    assert.equal(existsSync(join(temp, 'data/pipeline.md')), false, 'root pipeline untouched');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
