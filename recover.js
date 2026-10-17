#!/usr/bin/env node
/**
 * Recover the posting ledger from the cloud (dashboard /api/ledger).
 *
 * The ledger is what stops double-posts. After every run the Mac pushes a
 * copy to Vercel, so a fresh machine (or one with a wiped state/) can:
 *
 *   node recover.js            show local vs cloud, restore if local is missing/older
 *   node recover.js --force    overwrite local with the cloud copy
 *
 * Runs on a new Mac: clone repo -> npm install -> node recover.js ->
 * npm run login -> ./install-schedule.sh
 */
import fs from 'node:fs';

import { DIRS } from './src/paths.js';
import { dashboardSettings } from './src/sync.js';

const union = (a, b) => ({
  ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}),
  ...(b && typeof b === 'object' && !Array.isArray(b) ? b : {}),
});

async function main() {
  const { url, token, enabled } = dashboardSettings();
  if (!enabled) {
    console.error('No dashboard settings in state/dashboard.json (url + token). Pair this machine with the deployment: npm run sync:setup -- --url https://<project>.vercel.app --token <SYNC_TOKEN>   — or copy that file from a backup archive.');
    process.exitCode = 1;
    return;
  }
  const res = await fetch(`${url}/api/ledger`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Cloud ledger fetch returned HTTP ${res.status}`);
  const { ledger } = await res.json();
  if (!ledger?.posted) throw new Error('Cloud has no ledger yet — it is pushed automatically after every run.');

  let local = { posted: {}, attempts: {}, engaged: {} };
  let localExists = false;
  try {
    local = JSON.parse(fs.readFileSync(DIRS.stateFile, 'utf8'));
    localExists = true;
  } catch { /* no local ledger */ }

  const cloudCount = Object.keys(ledger.posted).length;
  const localCount = Object.keys(local.posted ?? {}).length;
  console.log(`Cloud ledger: ${cloudCount} posted · ${Object.keys(ledger.engaged ?? {}).length} engaged · saved ${ledger.savedAt}`);
  console.log(`Local ledger: ${localExists ? `${localCount} posted · ${Object.keys(local.engaged ?? {}).length} engaged` : 'missing'}`);

  const force = process.argv.includes('--force');
  const merge = process.argv.includes('--merge');

  let final = ledger;
  if (localExists && !force) {
    if (merge) {
      // Union: keep every hash from both sides (safe: posted set only grows).
      final = {
        posted: union(ledger.posted, local.posted),
        attempts: union(ledger.attempts, local.attempts),
      };
    } else if (localCount >= cloudCount) {
      console.log('Local copy is at least as new — nothing to do (use --merge to union both).');
      return;
    }
  }

  // `engaged` is unioned in every mode, --force included: it is an append-only
  // "never touch this post again" set, and dropping entries makes the bot
  // re-like and re-comment on posts it already engaged.
  const engaged = union(final.engaged, local.engaged);

  fs.mkdirSync(DIRS.stateDir, { recursive: true });
  fs.writeFileSync(DIRS.stateFile, JSON.stringify({
    posted: final.posted ?? {},
    attempts: final.attempts ?? {},
    engaged,
  }, null, 2) + '\n');
  console.log(`✔ Wrote ${Object.keys(final.posted ?? {}).length} posted · ${Object.keys(engaged).length} engaged entries to ${DIRS.stateFile}`);
}

main().catch((err) => {
  console.error(`✖ Recover failed: ${err.message}`);
  process.exitCode = 1;
});
