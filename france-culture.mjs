#!/usr/bin/env node
// Isolated profile entry point: --check is offline; --scan is always explicit.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as yaml from 'js-yaml';
import { validatePortalsConfig } from './validate-portals.mjs';
import { loadProviders, resolveProvider } from './providers/_registry.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
export async function checkFranceConfig(file) {
  const config = yaml.load(readFileSync(file, 'utf8'));
  const providers = await loadProviders(join(ROOT, 'providers'));
  const { errors, warnings } = await validatePortalsConfig(config, { providerIds: new Set(providers.keys()) });
  const sources = [...(Array.isArray(config?.tracked_companies) ? config.tracked_companies : []),
    ...(Array.isArray(config?.job_boards) ? config.job_boards : [])].filter(entry => entry && typeof entry === 'object').map(entry => {
    const resolved = resolveProvider(entry, providers);
    const provider = resolved?.provider?.id || null;
    const enabled = entry.enabled !== false;
    if (enabled && !provider) errors.push({ path: entry.name, message: resolved?.error || 'enabled source has no provider' });
    return { name: entry.name, enabled, provider, mode: enabled ? 'http' : 'manual/search query; no automatic coverage' };
  });
  return { file, errors, warnings, sources };
}

async function main(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('node france-culture.mjs --check [--file path]\nnode france-culture.mjs --scan [--file path] [--dry-run] [--json] [other scan.mjs flags]\n--check is offline. --scan uses a separate data/france-nonacademic data root.');
    return;
  }
  const options = [...args];
  let file = join(ROOT, 'config/france-nonacademic/portals.yml');
  const fileIndex = options.indexOf('--file');
  if (fileIndex >= 0) {
    if (!options[fileIndex + 1] || options[fileIndex + 1].startsWith('--')) throw new Error('--file requires a path');
    file = resolve(options[fileIndex + 1]);
    options.splice(fileIndex, 2);
  }
  const scan = options.includes('--scan');
  const check = options.includes('--check') || options.length === 0;
  if (scan && check) throw new Error('choose --check or --scan');
  if (!scan && options.some(a => a !== '--check')) throw new Error('unknown check option; use --help');
  const report = await checkFranceConfig(file);
  if (report.errors.length) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }
  if (!scan) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  // Preserve any caller's existing root/academic config, history and pipeline.
  // Deliberately do not inherit their profile (candidate status is unknown).
  const dataRoot = join(getCareerOpsRoot(), 'data/france-nonacademic');
  const result = spawnSync(process.execPath, [join(ROOT, 'scan.mjs'), ...options.filter(a => a !== '--scan')], {
    cwd: ROOT,
    env: {
      ...process.env,
      CAREER_OPS_ROOT: dataRoot,
      CAREER_OPS_DATA_DIR: dataRoot,
      CAREER_OPS_PORTALS: resolve(file),
      CAREER_OPS_PROFILE: join(dataRoot, 'config/profile.yml'),
      CAREER_OPS_PIPELINE: join(dataRoot, 'data/pipeline.md'),
      CAREER_OPS_SCAN_HISTORY: join(dataRoot, 'data/scan-history.tsv'),
    },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
if (isMainModule(import.meta.url)) main(process.argv.slice(2)).catch(err => { console.error(err.message); process.exitCode = 1; });
