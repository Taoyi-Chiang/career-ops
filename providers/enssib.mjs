// Enssib's public (non-alumni) Drupal job board. Only same-origin public pages;
// no login, no guessed country and no claim that a parsed posting is still open.
import { htmlToText } from './_html-to-text.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { buildTitleFilter } from '../title-keywords.mjs';

const ORIGIN = 'https://emplois-stages.enssib.fr';
function safeUrl(value, base = ORIGIN) {
  const url = new URL(decodeEntities(value), base);
  if (url.origin !== ORIGIN || url.username || url.password) throw new Error('enssib: untrusted URL');
  return url;
}

export function parseEnssibList(html) {
  const jobs = [];
  for (const row of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    if (!/views-field-title/.test(row[1])) continue;
    const link = row[1].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const url = safeUrl(link[1]);
    if (!url.pathname.startsWith('/emplois-stages/')) continue;
    const field = name => htmlToText(row[1].match(new RegExp(`views-field-${name}["'][^>]*>[\\s\\S]*?class=["']field-content["'][^>]*>([\\s\\S]*?)<\\/`, 'i'))?.[1] || '');
    const job = {
      title: htmlToText(link[2]), url: url.href,
      company: field('field-nom-de-l-employeur') || 'Enssib (employer unknown)',
      location: field('field-localisation-locality'),
    };
    const date = row[1].match(/<time\b[^>]*datetime=["']([^"']+)/i)?.[1];
    const postedAt = Date.parse(date || '');
    if (Number.isFinite(postedAt)) job.postedAt = postedAt;
    if (job.title) jobs.push(job);
  }
  const next = html.match(/<li\b[^>]*class=["'][^"']*pager__item--next[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)/i)?.[1];
  if (!jobs.length && !/view-empty/.test(html)) throw new Error('enssib: listing markup missing or changed (not a verified empty board)');
  return { jobs, next: next ? safeUrl(next).href : null };
}

export function parseEnssibDetail(html) {
  const article = html.match(/<article\b[^>]*node--type-emplois-stages[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if (!article) throw new Error('enssib: job article missing');
  // Keep metadata and conditions before the potentially long mission text so
  // salary/access/remote evidence cannot be lost to htmlToText's 4K body cap.
  const field = name => {
    const at = article.indexOf(`field--name-${name} `);
    if (at < 0) return '';
    const rest = article.slice(article.lastIndexOf('<div', at));
    const next = rest.indexOf('<div class="block ');
    return htmlToText(next < 0 ? rest : rest.slice(0, next));
  };
  const meta = ['field-type-de-contrat', 'field-remuneration-ou-gratificat', 'field-conditions-particulieres-d', 'field-localisation']
    .map(field).filter(Boolean).join('\n');
  const country = article.match(/class=["']country["'][^>]*>([^<]+)/i)?.[1];
  const city = article.match(/class=["']locality["'][^>]*>([^<]+)/i)?.[1];
  return {
    description: [meta, htmlToText(article)].filter(Boolean).join('\n'),
    location: [city, country].filter(Boolean).map(decodeEntities).join(', '),
  };
}

export default {
  id: 'enssib',
  detect(entry) {
    try { return new URL(entry.careers_url).origin === ORIGIN ? { url: ORIGIN } : null; } catch { return null; }
  },
  async fetch(entry, ctx) {
    const cfg = entry.enssib || {};
    const maxPages = cfg.max_pages ?? 10;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50) throw new Error('enssib: max_pages must be 1..50');
    const matchesTitle = buildTitleFilter(cfg.title_filter);
    let url = safeUrl(entry.careers_url || ORIGIN).href;
    const seenPages = new Set();
    const jobs = new Map();
    while (url && seenPages.size < maxPages) {
      if (seenPages.has(url)) throw new Error('enssib: pagination cycle');
      seenPages.add(url);
      const page = parseEnssibList(await ctx.fetchText(url));
      for (const job of page.jobs) {
        if (matchesTitle(job.title)) jobs.set(job.url, job);
      }
      url = page.next;
    }
    if (url) console.warn(`enssib: reached max_pages=${maxPages}; older pages were not scanned`);
    if (cfg.fetch_details === true) {
      for (const job of jobs.values()) {
        try {
          const detail = parseEnssibDetail(await ctx.fetchText(job.url));
          job.description = detail.description;
          if (detail.location) job.location = detail.location;
        } catch (err) {
          // A missing JD cannot turn unstated terms into negative evidence.
          job.note = `Enssib details unavailable: ${err.message}`;
        }
      }
    }
    return [...jobs.values()];
  },
};
