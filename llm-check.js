#!/usr/bin/env node
/**
 * Check the free LLM the automation will actually use — without ever printing
 * the key. Resolves the same config the scheduled run uses (dashboard → cache
 * → local config.json), reports the provider/model and where the key came
 * from, then makes one real call to generate a sample comment (src/chat.js
 * rotates the fallback models if the main one is throttled).
 *
 *   npm run llm:check
 *   npm run llm:check -- --local                 # skip the dashboard pull
 *   npm run llm:check -- --post "Post text…" --author "Some Creator"
 *   npm run llm:check -- --rewrite               # also test the article rewrite
 *
 * Exit 0 = the AI comment path works. Exit 1 = it will fall back (static pool
 * comment / extractive rewrite) — the automation still runs, just less smart.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ROOT } from './src/paths.js';
import { resolveConfig } from './src/sync.js';
import { generateComment, llmAvailable } from './src/comment.js';
import { rewriteForPost } from './src/summarize.js';
import { matchProvider, PROVIDERS } from './src/providers.js';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 || argv[i + 1]?.startsWith('--') ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);
const log = (...a) => console.log(...a);

/** Where the key for this llm block lives — never its value. */
function keyStatus(llm) {
  if (llm?.noAuth === true || matchProvider(llm?.baseUrl)?.noAuth) return 'not needed (local endpoint)';
  const envName = llm?.apiKeyEnv ?? 'REWRITE_API_KEY';
  if (process.env[envName]) return `env ${envName} ✓ (value hidden)`;
  const names = [llm?.apiKeyFile, 'state/rewrite.key'].filter((f) => typeof f === 'string' && f);
  for (const f of names) {
    const file = path.isAbsolute(f) ? f : path.join(ROOT, f);
    let raw = '';
    try {
      raw = fs.readFileSync(file, 'utf8').trim();
    } catch {
      continue;
    }
    if (raw) return `file ${f} ✓ (${raw.length} chars, value hidden)`;
  }
  return `MISSING — write it with "npm run llm:setup" (→ ${names[0] ?? 'state/rewrite.key'})`;
}

async function main() {
  let origin = 'local';
  let cfg;
  if (has('local')) {
    cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  } else {
    const resolved = await resolveConfig((m) => log(`  ${m}`));
    cfg = resolved.cfg;
    origin = resolved.origin;
  }

  const rw = cfg.rewrite ?? {};
  const eng = cfg.engagement ?? {};
  const engLlm = eng.llm ?? rw.llm ?? {};
  const preset = matchProvider(engLlm.baseUrl);
  const isFree = PROVIDERS.some((p) => p.baseUrl === String(engLlm.baseUrl ?? '').replace(/\/+$/, ''));

  log('\n🧠  LLM check — free provider for comments + article rewrites');
  log(`  config source   ${origin}`);
  log(`  provider        ${preset ? `${preset.label} (${preset.badge})` : 'custom endpoint'}`);
  log(`  base url        ${engLlm.baseUrl ?? '(default)'}`);
  log(`  model           ${engLlm.model ?? '(default)'}`);
  log(`  fallbacks       ${(engLlm.fallbackModels ?? []).join(' → ') || '(none)'}`);
  log(`  rewrites        mode=${rw.mode ?? 'auto'} · key: ${keyStatus(engLlm)}`);
  log(`  comments        mode=${eng.commentMode ?? 'ai'} · key: ${keyStatus(engLlm)}`);
  if (rw.llm && rw.llm.baseUrl !== engLlm.baseUrl) {
    log(`  note: rewrite.llm points at ${rw.llm.baseUrl} while engagement.llm overrides it.`);
  }

  if (!llmAvailable(engLlm)) {
    const p = PROVIDERS[0];
    log('\n  Without a key on this Mac, comments use the static pool and rewrites use the');
    log('  built-in extractive builder — no AI text. To turn on free AI text in ~2 minutes:');
    log(`   1. ${p.label} (${p.badge}, no card): ${p.signupUrl}`);
    log('   2. npm run llm:setup     ← hidden prompt, saved to state/rewrite.key (0600)');
    log('   3. npm run llm:check');
    log(`  Other free options: ${PROVIDERS.slice(1).map((x) => `${x.label} — ${x.signupUrl}`).join('\n                        ')}`);
    process.exitCode = 1;
    return;
  }

  const postText =
    opt('post') ??
    'Most ops teams measure how many tickets they close. We started measuring how many never open: ' +
    'same headcount, 40% fewer escalations, because we moved the fixes upstream into the checklist.';
  const author = opt('author') ?? 'Some Creator';
  const t0 = Date.now();
  const comment = await generateComment({ postText, authorName: author, llm: engLlm, log });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!comment) {
    log(`\n  ✗ no comment after ${secs}s — scheduled runs will use the pool fallback.`);
    log('    Usual causes: this model is not on your free tier, or the daily quota is spent.');
    log('    Add fallback models (dashboard → AI engine) or try a lighter free model / provider.');
    process.exitCode = 1;
    return;
  }
  log(`\n  ✓ comment generated in ${secs}s (${comment.length} chars):\n`);
  log(`     ${comment}`);
  log(`\n  Scheduled runs will leave comments like this on other people's posts.`);
  log(`  Cost: ${isFree ? 'free tier — no card, no billing.' : 'depends on the custom endpoint above.'}`);

  if (has('rewrite')) {
    log('\n  ⏳ testing the article rewrite path (one bigger call, ~10–30s on free tiers)…');
    const para =
      'Operations teams usually celebrate closed tickets, yet the number says little about real health. ' +
      'When a fix lands upstream the ticket never opens, and that is the outcome that compounds. ' +
      'The same headcount can absorb far more volume when checklists and defaults carry the lesson.';
    const candidate = {
      summarize: true,
      text: `Measure escalations avoided, not tickets closed\n\n${para}\n\n${para}\n\n${para}`,
      articleUrl: 'https://example.com/article',
      sourceType: 'substack',
    };
    try {
      const out = await rewriteForPost(candidate, rw, (m) => log(`  ${m}`));
      const first = String(out).split('\n')[0].slice(0, 78);
      log(`  ✓ rewrite produced ${String(out).length} chars — heading line: "${first}"`);
    } catch (err) {
      log(`  ✗ rewrite failed (${err.message}) — runs fall back to the extractive builder.`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(`llm-check crashed: ${err.message}`);
  process.exit(1);
});
