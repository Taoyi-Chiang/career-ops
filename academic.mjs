#!/usr/bin/env node

import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as yaml from 'js-yaml';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_PATH = process.env.ACADEMIC_PROFILE || path.join(ROOT, 'config', 'academic-profile.yml');
const PROFILE_TEMPLATE = path.join(ROOT, 'templates', 'academic-profile.example.yml');
const CV_TEMPLATE = path.join(ROOT, 'templates', 'cv-template.academic-classic.html');
const ACADEMIC_DATA_DIR = path.join(ROOT, 'data', 'academic');
const PORTALS_PATH = path.join(ACADEMIC_DATA_DIR, 'portals.yml');
const PIPELINE_PATH = path.join(ACADEMIC_DATA_DIR, 'pipeline.md');
const SCAN_HISTORY_PATH = path.join(ACADEMIC_DATA_DIR, 'scan-history.tsv');
const OUTPUT_DIR = path.join(ROOT, 'output', 'academic');

const FINISHED_STATUSES = new Set(['accepted', 'forthcoming', 'published', 'completed', 'current']);
const KNOWN_STATUSES = new Set([
  'planned', 'in_preparation', 'submitted', 'under_review',
  'accepted', 'forthcoming', 'published', 'completed', 'current',
]);

function printHelp() {
  console.log(`Academic career prototype

Usage:
  node academic.mjs init
  node academic.mjs validate
  node academic.mjs portals
  node academic.mjs scan [scan.mjs flags]
  node academic.mjs cv [--lang=en|zh-TW|fr|ja] [--include-wip] [--pdf]
  node academic.mjs status

Files:
  config/academic-profile.yml     private master data (gitignored)
  data/academic/portals.yml      generated academic scan lane
  data/academic/pipeline.md      academic-only discovery inbox
  output/academic/               generated CV artifacts
`);
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function loadProfile() {
  if (!existsSync(PROFILE_PATH)) {
    throw new Error(`Missing ${path.relative(ROOT, PROFILE_PATH)}. Run: node academic.mjs init`);
  }
  const parsed = yaml.load(readFileSync(PROFILE_PATH, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('academic-profile.yml must contain one YAML mapping/object.');
  }
  return parsed;
}

export function validateAcademicProfile(profile) {
  const errors = [];
  const warnings = [];
  if (!profile.person || typeof profile.person !== 'object') errors.push('person is required');
  const names = profile.person?.names;
  if (!names || typeof names !== 'object' || !Object.values(names).some(Boolean)) {
    errors.push('person.names must contain at least one display name');
  }

  const positives = profile.targets?.title_filter?.positive;
  if (!Array.isArray(positives) || positives.filter(Boolean).length === 0) {
    errors.push('targets.title_filter.positive must contain at least one keyword');
  }

  for (const section of ['publications', 'talks', 'education', 'appointments', 'teaching', 'awards', 'service', 'digital_outputs']) {
    const rows = profile.academic?.[section];
    if (rows != null && !Array.isArray(rows)) errors.push(`academic.${section} must be a list`);
    if (!Array.isArray(rows)) continue;
    for (const [index, row] of rows.entries()) {
      if (row?.status && !KNOWN_STATUSES.has(row.status)) {
        warnings.push(`academic.${section}[${index}].status has unknown value: ${row.status}`);
      }
    }
  }
  return { errors, warnings };
}

function assertValid(profile) {
  const result = validateAcademicProfile(profile);
  for (const warning of result.warnings) console.warn(`WARN: ${warning}`);
  if (result.errors.length) {
    for (const error of result.errors) console.error(`ERROR: ${error}`);
    throw new Error(`Profile validation failed with ${result.errors.length} error(s).`);
  }
  return result;
}

function compact(value) {
  return Array.isArray(value) ? value.filter(v => v != null && String(v).trim()) : [];
}

export function buildAcademicPortals(profile) {
  const target = profile.targets || {};
  const titleFilter = target.title_filter || {};
  const config = {
    scan_history: { recheck_after_days: Number(target.recheck_after_days) || 30 },
    max_posting_age_days: Number(target.max_posting_age_days) || 60,
    title_filter: {
      positive: compact(titleFilter.positive),
      negative: compact(titleFilter.negative),
    },
    job_boards: Array.isArray(target.job_boards) && target.job_boards.length
      ? target.job_boards
      : [{
          name: 'HigherEdJobs — Higher Education',
          provider: 'higheredjobs',
          cat_id: 68,
          enabled: true,
        }],
  };

  const locations = target.location_filter;
  if (locations && typeof locations === 'object') {
    const locationFilter = {};
    for (const key of ['always_allow', 'allow', 'block', 'block_hard']) {
      const values = compact(locations[key]);
      if (values.length) locationFilter[key] = values;
    }
    if (locations.strict === true) locationFilter.strict = true;
    if (Object.keys(locationFilter).length) config.location_filter = locationFilter;
  }

  return config;
}

function writePortals(profile) {
  ensureDir(ACADEMIC_DATA_DIR);
  const config = buildAcademicPortals(profile);
  const header = [
    '# Generated by academic.mjs from config/academic-profile.yml.',
    '# This is a separate academic discovery lane; root portals.yml is untouched.',
    '# Edit the master profile, then rerun: node academic.mjs portals',
    '',
  ].join('\n');
  writeFileSync(PORTALS_PATH, header + yaml.dump(config, { lineWidth: 100, noRefs: true }), 'utf8');
  return PORTALS_PATH;
}

function initProfile() {
  if (existsSync(PROFILE_PATH)) {
    console.log(`Already exists: ${path.relative(ROOT, PROFILE_PATH)}`);
    return;
  }
  ensureDir(path.dirname(PROFILE_PATH));
  copyFileSync(PROFILE_TEMPLATE, PROFILE_PATH);
  console.log(`Created ${path.relative(ROOT, PROFILE_PATH)} from the example profile.`);
}

function visibleRows(rows, includeWip) {
  if (!Array.isArray(rows)) return [];
  if (includeWip) return rows;
  return rows.filter(row => !row?.status || FINISHED_STATUSES.has(row.status));
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function pickLocalized(value, lang) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value !== 'object' || Array.isArray(value)) return '';
  return value[lang] || value.en || value['zh-TW'] || Object.values(value).find(Boolean) || '';
}

const LABELS = {
  en: {
    research: 'Research Profile', education: 'Education', appointments: 'Academic Appointments',
    publications: 'Selected Publications', talks: 'Selected Talks & Conferences', teaching: 'Teaching',
    digital_outputs: 'Digital Scholarship', awards: 'Awards & Fellowships', service: 'Academic Service',
  },
  'zh-TW': {
    research: '研究領域', education: '學歷', appointments: '學術經歷', publications: '代表著作',
    talks: '學術演講與會議', teaching: '教學經歷', digital_outputs: '數位學術成果',
    awards: '獎項與研究資助', service: '學術服務',
  },
  fr: {
    research: 'Domaines de recherche', education: 'Formation', appointments: 'Fonctions académiques',
    publications: 'Publications sélectionnées', talks: 'Communications sélectionnées',
    teaching: 'Enseignement', digital_outputs: 'Humanités numériques',
    awards: 'Prix et financements', service: 'Responsabilités académiques',
  },
  ja: {
    research: '研究分野', education: '学歴', appointments: '職歴', publications: '主要業績',
    talks: '研究発表', teaching: '教育歴', digital_outputs: 'デジタル研究成果',
    awards: '受賞・研究助成', service: '学術活動',
  },
};

function labelsFor(lang) {
  return LABELS[lang] || LABELS.en;
}

function detailsList(details) {
  const items = compact(details);
  return items.length ? `<ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
}

function entry(title, meta, details = []) {
  return `<article class="entry"><div class="entry-head"><div class="entry-title">${esc(title)}</div>${meta ? `<div class="entry-meta">${esc(meta)}</div>` : ''}</div>${detailsList(details)}</article>`;
}

function statusSuffix(row) {
  if (!row?.status || ['published', 'completed', 'current'].includes(row.status)) return '';
  return ` [${row.status.replaceAll('_', ' ')}]`;
}

export function renderAcademicCv(profile, { lang = 'en', includeWip = false } = {}) {
  const labels = labelsFor(lang);
  const person = profile.person || {};
  const academic = profile.academic || {};
  const name = pickLocalized(person.names, lang);
  const headline = pickLocalized(person.headline, lang);
  const contacts = compact([
    person.contact?.location,
    person.contact?.email,
    person.contact?.website,
    person.contact?.orcid ? `ORCID ${person.contact.orcid}` : '',
  ]);

  const sections = [];
  const interests = compact((profile.research?.interests || []).map(x => pickLocalized(x, lang)));
  const summary = pickLocalized(profile.research?.summary, lang);
  if (summary || interests.length) {
    sections.push(`<section><h2>${esc(labels.research)}</h2>${summary ? `<p class="summary">${esc(summary)}</p>` : ''}${interests.length ? `<p class="keywords">${interests.map(esc).join(' · ')}</p>` : ''}</section>`);
  }

  const education = visibleRows(academic.education, includeWip);
  if (education.length) {
    sections.push(`<section><h2>${esc(labels.education)}</h2>${education.map(row => entry(
      pickLocalized(row.degree, lang),
      compact([pickLocalized(row.institution, lang), pickLocalized(row.location, lang), row.dates]).join(' · '),
      row.details,
    )).join('')}</section>`);
  }

  const appointments = visibleRows(academic.appointments, includeWip);
  if (appointments.length) {
    sections.push(`<section><h2>${esc(labels.appointments)}</h2>${appointments.map(row => entry(
      pickLocalized(row.title, lang),
      compact([pickLocalized(row.institution, lang), pickLocalized(row.location, lang), row.dates]).join(' · '),
      row.details,
    )).join('')}</section>`);
  }

  const publications = visibleRows(academic.publications, includeWip);
  if (publications.length) {
    sections.push(`<section><h2>${esc(labels.publications)}</h2><ol class="bibliography">${publications.map(row => `<li>${esc(pickLocalized(row.citation, lang) || row.title)}${esc(statusSuffix(row))}</li>`).join('')}</ol></section>`);
  }

  const talks = visibleRows(academic.talks, includeWip);
  if (talks.length) {
    sections.push(`<section><h2>${esc(labels.talks)}</h2>${talks.map(row => entry(
      pickLocalized(row.title, lang),
      compact([pickLocalized(row.event, lang), pickLocalized(row.place, lang), row.date]).join(' · '),
      row.details,
    )).join('')}</section>`);
  }

  const teaching = visibleRows(academic.teaching, includeWip);
  if (teaching.length) {
    sections.push(`<section><h2>${esc(labels.teaching)}</h2>${teaching.map(row => entry(
      pickLocalized(row.course, lang),
      compact([pickLocalized(row.institution, lang), pickLocalized(row.role, lang), row.dates]).join(' · '),
      row.details,
    )).join('')}</section>`);
  }

  for (const key of ['digital_outputs', 'awards', 'service']) {
    const rows = visibleRows(academic[key], includeWip);
    if (!rows.length) continue;
    sections.push(`<section><h2>${esc(labels[key])}</h2>${rows.map(row => entry(
      pickLocalized(row.title || row.name, lang),
      compact([pickLocalized(row.institution || row.organization, lang), row.date || row.dates]).join(' · '),
      row.details,
    )).join('')}</section>`);
  }

  const template = readFileSync(CV_TEMPLATE, 'utf8');
  return template
    .replaceAll('{{LANG}}', esc(lang))
    .replaceAll('{{NAME}}', esc(name))
    .replaceAll('{{HEADLINE}}', esc(headline))
    .replaceAll('{{CONTACT}}', contacts.map(esc).join(' · '))
    .replaceAll('{{SECTIONS}}', sections.join('\n'));
}

function argValue(args, prefix, fallback) {
  const found = args.find(x => x.startsWith(`${prefix}=`));
  return found ? found.slice(prefix.length + 1) : fallback;
}

async function writeCv(profile, args) {
  const lang = argValue(args, '--lang', profile.locale || 'en');
  const includeWip = args.includes('--include-wip');
  ensureDir(OUTPUT_DIR);
  const htmlPath = path.join(OUTPUT_DIR, `cv-${lang}.html`);
  const pdfPath = path.join(OUTPUT_DIR, `cv-${lang}.pdf`);
  writeFileSync(htmlPath, renderAcademicCv(profile, { lang, includeWip }), 'utf8');
  console.log(`Wrote ${path.relative(ROOT, htmlPath)}`);

  if (args.includes('--pdf')) {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
    } finally {
      await browser.close();
    }
    console.log(`Wrote ${path.relative(ROOT, pdfPath)}`);
  }
}

function runScan(profile, args) {
  writePortals(profile);
  ensureDir(ACADEMIC_DATA_DIR);
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scan.mjs'), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      CAREER_OPS_PORTALS: PORTALS_PATH,
      CAREER_OPS_PIPELINE: PIPELINE_PATH,
      CAREER_OPS_SCAN_HISTORY: SCAN_HISTORY_PATH,
    },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function printStatus(profile) {
  const counts = {};
  for (const section of ['education', 'appointments', 'publications', 'talks', 'teaching', 'digital_outputs', 'awards', 'service']) {
    counts[section] = Array.isArray(profile.academic?.[section]) ? profile.academic[section].length : 0;
  }
  console.log(`Academic profile: ${path.relative(ROOT, PROFILE_PATH)}`);
  console.log(`Target title keywords: ${profile.targets?.title_filter?.positive?.length || 0}`);
  console.log(`CV entries: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`Academic pipeline: ${path.relative(ROOT, PIPELINE_PATH)}`);
}

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (command === 'help' || command === '--help' || command === '-h') return printHelp();
  if (command === 'init') return initProfile();

  const profile = loadProfile();
  assertValid(profile);

  if (command === 'validate') {
    console.log('Academic profile is valid.');
    return;
  }
  if (command === 'portals') {
    const out = writePortals(profile);
    console.log(`Wrote ${path.relative(ROOT, out)}`);
    return;
  }
  if (command === 'scan') return runScan(profile, args);
  if (command === 'cv') return writeCv(profile, args);
  if (command === 'status') return printStatus(profile);
  throw new Error(`Unknown command: ${command}`);
}

main().catch(err => {
  console.error(`academic: ${err.message}`);
  process.exitCode = 1;
});
