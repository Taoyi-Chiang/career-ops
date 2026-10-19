// Optional, evidence-only employment triage. Vocabulary belongs in portals.yml;
// an absent block is a no-op. No candidate immigration status is inferred.
import { compileContentKeyword, foldAccents } from './title-keywords.mjs';

export const EMPLOYMENT_SIGNALS = [
  'paid', 'unpaid', 'remote', 'onsite', 'france_eligible', 'france_ineligible',
  'sponsorship_available', 'sponsorship_unavailable', 'authorization_required',
  'nationality_restricted', 'contract_open', 'officials_only',
  'france_location', 'foreign_location',
];
export const EMPLOYMENT_OPTIONS = ['reject_explicit_unpaid', 'reject_france_ineligible'];

export function validateEmploymentFilter(config) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return [{ path: 'employment_filter', message: 'must be an object' }];
  }
  for (const key of Object.keys(config)) {
    if (![...EMPLOYMENT_OPTIONS, 'signals'].includes(key)) {
      errors.push({ path: `employment_filter.${key}`, message: 'unknown field' });
    }
  }
  for (const key of EMPLOYMENT_OPTIONS) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') {
      errors.push({ path: `employment_filter.${key}`, message: 'must be a boolean' });
    }
  }
  if (!config.signals || typeof config.signals !== 'object' || Array.isArray(config.signals)) {
    errors.push({ path: 'employment_filter.signals', message: 'must be an object of keyword arrays' });
  } else {
    for (const [key, list] of Object.entries(config.signals)) {
      if (!EMPLOYMENT_SIGNALS.includes(key)) {
        errors.push({ path: `employment_filter.signals.${key}`, message: 'unknown signal' });
      }
      if (!Array.isArray(list) || list.some(k => typeof k !== 'string' || !k.trim())) {
        errors.push({ path: `employment_filter.signals.${key}`, message: 'must be an array of non-empty strings' });
      }
    }
  }
  return errors;
}

const normalize = value => foldAccents(String(value ?? '').toLowerCase());
const state = (yes, no) => yes && no ? 'conflict' : yes ? 'yes' : no ? 'no' : 'unknown';

export function buildEmploymentFilter(config) {
  if (config === undefined) return () => null;
  const errors = validateEmploymentFilter(config);
  if (errors.length) throw new Error(errors.map(e => `${e.path}: ${e.message}`).join('; '));
  const matchers = Object.fromEntries(EMPLOYMENT_SIGNALS.map(key => [key,
    (config.signals[key] || []).map(keyword => ({ keyword, match: compileContentKeyword(normalize(keyword.trim())) })),
  ]));
  return (job = {}) => {
    // Do not read the source's footer, employer name or note as hiring evidence.
    const body = normalize([job.title, job.description, job.employmentType].filter(Boolean).join('\n'));
    const where = normalize([job.title, job.location, job.description].filter(Boolean).join('\n'));
    const evidence = Object.fromEntries(EMPLOYMENT_SIGNALS.map(key => [key,
      matchers[key].filter(m => m.match(['france_location', 'foreign_location'].includes(key) ? normalize(job.location)
        : ['remote', 'onsite', 'france_eligible', 'france_ineligible'].includes(key) ? where : body))
        .map(m => m.keyword),
    ]));
    const has = key => evidence[key].length > 0;
    const salaryStated = [job.salary?.min, job.salary?.max].some(n => typeof n === 'number' && Number.isFinite(n) && n > 0);
    if (salaryStated) evidence.paid.push('structured_salary>0');
    const remote = state(has('remote'), has('onsite'));
    // An unrecognised city is unknown, not outside France. A named foreign
    // location is excluded only when no remote/France alternative is stated.
    const foreignOnsite = has('foreign_location') && !has('france_location') && remote !== 'yes' && !has('france_eligible');
    const result = {
      payment: state(has('paid'), has('unpaid')),
      remote,
      france_eligibility: state(has('france_eligible') || has('france_location'), has('france_ineligible') || foreignOnsite),
      sponsorship: state(has('sponsorship_available'), has('sponsorship_unavailable')),
      authorization_required: has('authorization_required') ? 'stated' : 'unknown',
      nationality_restriction: has('nationality_restricted') ? 'stated' : 'unknown',
      public_access: state(has('contract_open'), has('officials_only')),
      evidence,
      reasons: [],
    };
    if (config.reject_explicit_unpaid && result.payment === 'no') result.reasons.push('explicitly_unpaid');
    if (config.reject_france_ineligible && result.france_eligibility === 'no') result.reasons.push('france_ineligible');
    result.keep = result.reasons.length === 0;
    return result;
  };
}

export function formatEmploymentNote(result) {
  return `employment: payment=${result.payment}; remote=${result.remote}; france=${result.france_eligibility}; sponsorship=${result.sponsorship}; authorization_required=${result.authorization_required}; nationality_restriction=${result.nationality_restriction}; public_contract_access=${result.public_access}`;
}
