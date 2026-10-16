import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';
import { DEFAULT_LLM, keyless } from './providers.js';
import { chatCompletion } from './chat.js';

/**
 * Comment text for outbound engagement on OTHER people's posts.
 *
 * Primary engine is an LLM (OpenAI-compatible `/chat/completions`, any free
 * provider — see src/providers.js): a short, genuine, first-person reply
 * tailored to the post. The call itself goes through src/chat.js, which
 * rotates llm.model + llm.fallbackModels and absorbs free-tier 429s. When no
 * key is configured or every model fails, the caller falls back to a static
 * pool/fixed comment, so a rate-limited free tier can never break a run.
 * The API key is NEVER stored here — it is read at runtime from an env var
 * (llm.apiKeyEnv) or a git-ignored file (llm.apiKeyFile), exactly like
 * src/summarize.js does.
 */

/** Env var / file names to try, in order (config override then the default). */
function keySources(llm) {
  // `apiKeyFile: false` = deliberately keyless (forces the pool/fixed fallback
  // even though a key exists on this Mac — handy for one source or one mode).
  if (llm?.apiKeyFile === false) return null;
  const envNames = [llm?.apiKeyEnv, DEFAULT_LLM.apiKeyEnv].filter(Boolean);
  for (const name of envNames) {
    if (process.env[name]) return process.env[name].trim();
  }
  const files = [llm?.apiKeyFile, DEFAULT_LLM.apiKeyFile].filter((f) => typeof f === 'string' && f);
  for (const f of files) {
    const file = path.isAbsolute(f) ? f : path.join(ROOT, f);
    try {
      const key = fs.readFileSync(file, 'utf8').trim();
      if (key) return key;
    } catch {
      /* try the next source */
    }
  }
  return null;
}

/** The key for this call, or '' for a keyless local endpoint. null = none. */
function readKey(llm) {
  if (keyless(llm)) return '';
  return keySources(llm);
}

/** True when comment generation can run: a key exists or the endpoint is keyless. */
export function llmAvailable(llm) {
  return readKey(llm) !== null;
}

/** Static fallback: fixed text, else a random pool comment, else null. */
export function fallbackComment(cfg) {
  if (cfg?.commentMode === 'fixed') return (cfg.text ?? '').trim() || null;
  if (cfg?.commentMode === 'pool' || cfg?.commentMode === 'ai') {
    const pool = (cfg?.pool ?? []).map((t) => (t ?? '').trim()).filter(Boolean);
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  return null;
}

/** Keep a generated comment plain and human: trim, strip quotes, cap length. */
function clean(text) {
  let s = String(text ?? '').trim().replace(/^["“”]|["“”]$/g, '').trim();
  s = s.replace(/\s+/g, ' ');
  if (s.length > 280) s = `${s.slice(0, 277).replace(/[\s,.;:]+$/, '')}…`;
  return s;
}

const SYSTEM =
  'You write thoughtful comments on LinkedIn as the account owner (a founder/ops ' +
  'leader in India). Given someone else\'s post, write ONE short comment reply. ' +
  'Rules: 1-2 sentences, under 240 characters; warm and specific to the post\'s ' +
  'actual point — add a small own insight, agreement, or an open question; ' +
  'first person; plain text only — NO hashtags, NO @mentions, NO emoji spam ' +
  '(at most one natural emoji), NO links, NO "as an AI". Do not greet or thank ' +
  'generically. Reply with ONLY the comment text.';

/**
 * Generate a tailored comment for one post via src/chat.js (free-tier
 * resilience: llm.model then llm.fallbackModels, throttle wait-and-retry).
 * Returns the comment string, or null when generation is unavailable/failed
 * (caller then uses fallbackComment).
 */
export async function generateComment({ postText, authorName, llm, log }) {
  const key = readKey(llm);
  if (key === null) return null;
  const base = (llm?.baseUrl ?? DEFAULT_LLM.baseUrl).replace(/\/+$/, '');
  const excerpt = String(postText ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200);
  if (!excerpt) return null;
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `${authorName ? `Post by ${authorName}:\n` : ''}${excerpt}` },
  ];
  const res = await chatCompletion({
    llm,
    base,
    key,
    log,
    label: 'engage',
    buildBody: (model) => ({
      body: {
        model,
        temperature: Number(llm?.temperature) || 0.8,
        messages,
        // 400, not 120: reasoning fallbacks (e.g. nemotron:free) spend part of
        // the budget on hidden thinking — too small a cap returns 200 with
        // empty content. clean() still caps the comment at 280 chars.
        max_tokens: Number(llm?.maxTokens) || 400,
      },
      // Free providers that reject sampling params still answer this shape.
      relaxBody: { model, messages },
    }),
  });
  return res ? clean(res.text) || null : null;
}
