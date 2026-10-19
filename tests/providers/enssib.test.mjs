import { test } from 'node:test';
import assert from 'node:assert/strict';
import enssib, { parseEnssibList, parseEnssibDetail } from '../../providers/enssib.mjs';

// Synthetic content using the public Drupal field names inspected 2026-10-19.
const row = (title, slug, city = 'Lyon') => `<li><div class="views-field views-field-title"><span class="field-content"><a href="/emplois-stages/${slug}" hreflang="fr">${title}</a></span></div><div class="views-field views-field-created"><span class="field-content"><time datetime="2026-10-19T09:12:39+02:00">19 octobre 2026</time></span></div><span class="views-field views-field-field-nom-de-l-employeur"><span class="views-label">Structure: </span><span class="field-content">Bibliothèque &amp; archives (fixture)</span></span><div class="views-field views-field-field-localisation-locality"><span class="field-content">${city}</span></div></li>`;
const listing = (rows, next = '') => `<div class="view-content"><ul>${rows}</ul></div>${next ? `<li class="pager__item pager__item--next"><a href="${next}">Suivant</a></li>` : ''}`;
const detail = `<article class="node node--type-emplois-stages node--view-mode-full"><div class="block x"><div class="field field--name-field-type-de-contrat field--label-inline"><div class="field__label">Type de contrat</div><div class="field__item">CDD</div></div></div><div class="block x"><div class="field field--name-field-conditions-particulieres-d field--label-above"><p>Télétravail depuis la France. Autorisation de travail requise.</p></div></div><div class="block x"><div class="field field--name-field-localisation field--type-address"><span class="locality">Lyon</span><span class="country">France</span></div></div><p>Gestion des collections numériques.</p></article><footer>Unpaid role. UK only. (Not job evidence.)</footer>`;

test('Enssib list preserves title, employer, city, date and pagination', () => {
  const actual = parseEnssibList(listing(row('Chargé·e de données', 'data'), '?page=1'));
  assert.equal(actual.jobs[0].title, 'Chargé·e de données');
  assert.equal(actual.jobs[0].company, 'Bibliothèque & archives (fixture)');
  assert.equal(actual.jobs[0].location, 'Lyon');
  assert.equal(actual.jobs[0].postedAt, Date.parse('2026-10-19T09:12:39+02:00'));
  assert.equal(actual.next, 'https://emplois-stages.enssib.fr/?page=1');
});
test('Enssib details retain hiring evidence, exclude footer, and never guess location', () => {
  const actual = parseEnssibDetail(detail);
  assert.equal(actual.location, 'Lyon, France');
  assert.match(actual.description, /CDD/);
  assert.match(actual.description, /Autorisation de travail requise/);
  assert.doesNotMatch(actual.description, /Unpaid role|UK only|field--name/);
  assert.equal(parseEnssibDetail('<article class="node--type-emplois-stages"><p>Documentation.</p></article>').location, '');
});
test('changed markup fails loudly; explicit empty results remain empty', () => {
  assert.throws(() => parseEnssibList('<html>Bot check</html>'), /markup missing/);
  assert.deepEqual(parseEnssibList('<div class="view-empty">Aucune offre</div>').jobs, []);
  assert.throws(() => parseEnssibDetail('<html>Not found</html>'), /article missing/);
});
test('external listing/detail URLs cannot escape the source origin', () => {
  assert.equal(enssib.detect({ careers_url: 'https://alumni.enssib.fr/jobs' }), null);
  assert.throws(() => parseEnssibList(listing(row('Documentaliste', 'x'), 'https://evil.example/?page=1')), /untrusted/);
});
test('provider paginates, applies the shared title predicate, and keeps detail failures unknown', async () => {
  const calls = [];
  const ctx = { fetchText: async url => {
    calls.push(url);
    if (url === 'https://emplois-stages.enssib.fr/') return listing(row('Documentaliste', 'docs') + row('AI Engineer', 'tech'), '?page=1');
    if (url.endsWith('?page=1')) return listing(row('Archiviste numérique', 'archive', ''));
    if (url.endsWith('/docs')) return detail;
    throw new Error('detail unavailable');
  } };
  const jobs = await enssib.fetch({ enssib: { max_pages: 3, fetch_details: true, title_filter: { positive: ['documentaliste', 'archiviste'] } } }, ctx);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].location, 'Lyon, France');
  assert.equal(jobs[1].location, '');
  assert.equal(jobs[1].description, undefined);
  assert.match(jobs[1].note, /details unavailable/);
  assert.equal(calls.some(url => url.endsWith('/tech')), false);
});
