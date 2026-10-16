import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';
import { DEFAULT_LLM, keyless } from './providers.js';
import { chatCompletion } from './chat.js';

/**
 * Rewrite stage: turns a full article (substack/medium) into a structured
 * LinkedIn post.
 *
 * Template shape (config.rewrite.template.enabled — on for substack/medium):
 *   1. Heading                     — concise, engaging, no clickbait
 *   2. Three key takeaways         — numbered 1-3, each EXACTLY N words
 *                                    (config.rewrite.template.takeawayWords,
 *                                    default 25), validated programmatically
 *                                    and regenerated while invalid
 *   3. Five bullet points          — each with a short BOLD intro phrase
 *   4. Article image status        — attached / unavailable (never invented)
 *   5. Source                      — the original article URL
 *   Footer                         — follow + removal/credit lines (config)
 *
 * Two engines, chosen by config.rewrite.mode:
 *   "extractive" — no API needed: score the article's sentences (keyword
 *     density + position) and fit them to the template. Word counts are
 *     enforced deterministically (whole-word trim, contiguous expansion
 *     inside the article text, neutral filler only as last resort).
 *   "llm"        — calls an OpenAI-compatible chat API (through src/chat.js,
 *     which rotates llm.model + llm.fallbackModels and waits out free-tier
 *     throttling) for a JSON post,
 *     validated against the same spec; retried once with the failures fed
 *     back; falls back to extractive if still invalid. Any free provider works
 *     (Google Gemini / OpenRouter / Groq / local Ollama — see
 *     src/providers.js). The API key is NEVER stored here: it is read at
 *     runtime from an env var (config.rewrite.llm.apiKeyEnv) or a git-ignored
 *     file (config.rewrite.llm.apiKeyFile, e.g. state/rewrite.key) that the
 *     user creates themselves (`npm run llm:setup`).
 *   "auto" (default) — LLM when a key is available, extractive otherwise.
 *
 * Every rewritten post carries a source link (config.rewrite.attribution,
 * default true): summarized-with-credit is safe curation; silent rewrites of
 * someone else's article are neither polite nor defensible.
 */

const API_KEY_MAX_AGE_MS = 0; // re-read the key file every run (no caching)

function readKey(llmCfg) {
  if (keyless(llmCfg)) return '';
  if (llmCfg?.apiKeyFile === false) return null; // deliberate: no AI, use extractive
  const envNames = [llmCfg?.apiKeyEnv, DEFAULT_LLM.apiKeyEnv].filter(Boolean);
  for (const name of envNames) {
    if (process.env[name]) return process.env[name].trim();
  }
  const files = [llmCfg?.apiKeyFile, DEFAULT_LLM.apiKeyFile].filter((f) => typeof f === 'string' && f);
  for (const f of files) {
    const file = path.isAbsolute(f) ? f : path.join(ROOT, f);
    try {
      const key = fs.readFileSync(file, 'utf8').trim();
      void API_KEY_MAX_AGE_MS;
      if (key) return key;
    } catch {
      /* try the next source */
    }
  }
  return null;
}

/** Split an article body into URL-free, scoreable sentences. */
function collectSentences(body) {
  const text = String(body ?? '');
  const paragraphs = text.split('\n\n').map((p) => p.trim()).filter(Boolean);
  const sentences = [];
  paragraphs.forEach((para, pi) => {
    for (const s of para.split(/(?<=[.!?…])\s+(?=["'“(\[]?[A-Z0-9])/u)) {
      // Raw URLs clutter the post, eat the char budget, and make LinkedIn
      // build a link-preview card that suppresses the cover image.
      const t = s
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/\b[\w.-]+\.(?:com|net|org|io|ai|co|app|dev|xyz)\b\/?\S*/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (t.length >= 40) sentences.push({ t, pi });
    }
  });
  return sentences;
}

function scoreSentences(sentences, title) {
  const freq = new Map();
  for (const s of sentences) {
    for (const w of s.t.toLowerCase().match(/[\p{L}][\p{L}\p{N}']*/gu) ?? []) {
      if (w.length < 4) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  const titleWords = new Set(
    String(title ?? '').toLowerCase().match(/[\p{L}][\p{L}\p{N}']*/gu) ?? [],
  );
  for (const s of sentences) {
    const words = s.t.toLowerCase().match(/[\p{L}][\p{L}\p{N}']*/gu) ?? [];
    let score = 0;
    for (const w of words) score += freq.get(w) ?? 0;
    score /= Math.sqrt(Math.max(words.length, 1));
    if (s.pi === 0) score *= 1.3; // the lead paragraph usually carries the thesis
    for (const tw of titleWords) if (words.includes(tw)) score *= 1.15;
    s.score = score;
  }
}

/**
 * Legacy plain-summary mode (template disabled): title + the article's
 * strongest sentences, in the original order, capped near targetChars.
 */
export function extractivePost(title, body, { targetChars = 900, maxSentences = 7 } = {}) {
  const text = String(body ?? '');
  const sentences = collectSentences(text);
  if (!sentences.length) {
    return title ? `${title}\n\n${text.slice(0, targetChars)}` : text.slice(0, targetChars);
  }
  scoreSentences(sentences, title);

  const ranked = [...sentences].sort((a, b) => b.score - a.score);
  const picked = [];
  let used = 0;
  for (const s of ranked) {
    if (picked.length >= maxSentences || used + s.t.length > targetChars) {
      if (picked.length && used > targetChars * 0.5) break;
      if (picked.length >= maxSentences) break;
      if (used + s.t.length > targetChars) continue; // try shorter sentences
    }
    picked.push(s);
    used += s.t.length + 1;
  }
  picked.sort((a, b) => (a.pi - b.pi) || (sentences.indexOf(a) - sentences.indexOf(b)));
  const summary = picked.map((s) => s.t).join(' ');
  return title ? `${title}\n\n${summary}` : summary;
}

/* ------------------------------------------------------------------------ */
/* Structured template                                                       */
/* ------------------------------------------------------------------------ */

const LEAD_EMOJI = /^(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+\s*)+/u;
const SENT_SPLIT = /(?<=[.!?…])\s+(?=["'“(\[]?[A-Z0-9])/u;

// Last-resort neutral clauses used only when no article text remains to
// extend a takeaway to the exact word count. Factual about the post itself —
// never an invented claim about the article's content.
const PADDING_SENTENCES = [
  'The full article explains this point in detail with useful context worth reading',
  'The article also shares practical lessons about this topic worth applying',
  'Read the source piece below for the complete explanation and examples',
];

function wordsOf(s) {
  return String(s ?? '').trim().split(/\s+/).filter(Boolean);
}

function stripUrlJunk(s) {
  return String(s ?? '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b[\w.-]+\.(?:com|net|org|io|ai|co|app|dev|xyz)\b\/?\S*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split into whole words with their trailing punctuation attached. */
function wordTokens(s) {
  return String(s ?? '').match(/\S+/g) ?? [];
}

/**
 * Force a piece of text to exactly `n` words, fabricating nothing:
 *  - too many words  → keep the first n (whole words, cleaned punctuation)
 *  - too few words   → first extend with the sentence's own remainder, then
 *                      with contiguous up-to-n-word windows taken from the
 *                      article (real text, so no unsupported claims), and
 *                      only if the article is exhausted fall back to a
 *                      neutral filler clause.
 * `state` = { i, k, taken:[{start,count}] } tracks cursor, filler rotation
 * and article windows already used, so fields never repeat text.
 */
export function fitWords(core, n, bodyWords = [], state = { i: 0, k: 0, taken: [] }) {
  const clean = stripUrlJunk(core).replace(/[…]/g, '').trim();
  let toks = wordTokens(clean);
  if (toks.length > n) toks = toks.slice(0, n);
  let text = toks.join(' ');

  const overlapsTaken = (start, count) =>
    state.taken.some((t) => start < t.start + t.count && t.start < start + count);

  let guard = 0;
  while (wordsOf(text).length < n && guard++ < 40) {
    const missing = n - wordsOf(text).length;
    let addition = '';

    const leftover = wordTokens(clean).slice(toks.length, toks.length + missing).join(' ');
    if (leftover) {
      addition = leftover;
    } else {
      while (state.i < bodyWords.length && !addition) {
        const count = Math.min(missing, bodyWords.length - state.i);
        if (count >= 3 && !overlapsTaken(state.i, count)) {
          addition = bodyWords.slice(state.i, state.i + count).join(' ');
          state.taken.push({ start: state.i, count });
          state.i += count;
        } else {
          state.i += 1;
        }
      }
      if (!addition) {
        const filler = wordTokens(PADDING_SENTENCES[state.k % PADDING_SENTENCES.length])
          .slice(0, missing)
          .join(' ');
        state.k += 1;
        addition = filler;
      }
    }
    text = `${text} ${addition}`.replace(/\s+/g, ' ').trim();
    toks = wordTokens(text);
    if (toks.length > n) toks = toks.slice(0, n); // additions may overshoot
    text = toks.join(' ');
  }
  // Hard guarantee: never exceed the exact count.
  const finalToks = wordTokens(text);
  if (finalToks.length > n) text = finalToks.slice(0, n).join(' ');
  return text.replace(/\s+([,.;:])/g, '$1').trim();
}

/** Short, title-cased bold lead phrase for a bullet ("The Core Idea:"). */
const STOP_INTROS = new Set([
  'the', 'a', 'an', 'and', 'but', 'or', 'of', 'in', 'on', 'to', 'for', 'with',
  'this', 'that', 'these', 'those', 'it', 'its', 'is', 'are', 'was', 'were',
  'be', 'been', 'as', 'at', 'by', 'from', 'if', 'when', 'while', 'what',
]);

function cleanWords(sentence) {
  return wordsOf(String(sentence ?? '').replace(LEAD_EMOJI, ''))
    .map((w) => w.replace(/[^\p{L}\p{N}']/gu, ''))
    .filter(Boolean);
}

function capWord(w) {
  if (/^[A-Z]{2,}$/.test(w)) return w; // keep acronyms: AI, SEO, B2B
  if (w === w.toUpperCase() && w.length > 3) return w[0] + w.slice(1).toLowerCase();
  return w[0].toUpperCase() + w.slice(1);
}

/** Bold lead phrase for a bullet + how many original words it consumed. */
function leadPhrase(sentence) {
  const words = cleanWords(sentence);
  const skip = STOP_INTROS.has((words[0] ?? '').toLowerCase()) ? 1 : 0;
  const take = words.slice(skip, skip + 4);
  if (!take.length) return { phrase: 'Key Point:', consumed: 0 };
  return { phrase: `${take.map(capWord).join(' ')}:`, consumed: skip + take.length };
}

/** ASCII -> mathematical bold (LinkedIn plain text has no markdown bold). */
export function unicodeBold(s) {
  return String(s ?? '')
    .replace(/[A-Z]/g, (c) => String.fromCodePoint(c.codePointAt(0) - 65 + 0x1d400))
    .replace(/[a-z]/g, (c) => String.fromCodePoint(c.codePointAt(0) - 97 + 0x1d41a))
    .replace(/[0-9]/g, (c) => String.fromCodePoint(c.codePointAt(0) - 48 + 0x1d7ce));
}

function headingFrom(title) {
  let t = String(title ?? '')
    .replace(LEAD_EMOJI, '')
    .replace(/[#*_<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const w = wordsOf(t);
  if (w.length > 13) t = w.slice(0, 13).join(' ');
  if (t.length > 80) t = t.slice(0, 78).replace(/[\s,;:-]+$/, '') + '…';
  return t;
}

/** Human-readable status of the article cover image — never an invented URL. */
export function imageStatus(candidate) {
  if (candidate?.media?.length) {
    return 'Article image: original cover from the article source, attached to this post.';
  }
  if (candidate?.coverUrl) {
    return 'Article image: original cover was linked by the article but could not be downloaded.';
  }
  return 'Article image: no legitimate cover image was available for this article.';
}

/**
 * Deterministic template builder: derives every field from real article text
 * (highest-scoring sentences) and enforces the word counts exactly.
 */
export function buildExtractiveTemplate({
  title = '',
  body = '',
  candidate = {},
  takeawayWords = 25,
  bullets = 5,
  sourceLine = '',
  footer = '',
} = {}) {
  const n = Math.max(4, Number(takeawayWords) || 25);
  const sentences = collectSentences(body);
  if (sentences.length) scoreSentences(sentences, title);

  // Contiguous article words used to extend short takeaways with real text.
  const bodyWords = (String(body ?? '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).filter((w) => w.length > 1);
  const fitState = { i: 0, k: 0, taken: [] };

  const ranked = [...sentences].sort((a, b) => b.score - a.score);
  let pool = ranked;
  if (pool.length && pool.length < 8) {
    // Thin article: recycle the best sentences so the template still fills
    // 3 takeaways + 5 bullets. Score order puts duplicates far apart.
    while (pool.length < 8) pool = [...pool, ...ranked];
  }
  if (!pool.length) {
    // Near-empty article: synthesize from body words / neutral filler so the
    // post always satisfies the structure.
    pool = Array.from({ length: 8 }, () => ({ t: '', pi: 0, score: 0 }));
  }

  // Mark the body spans the three core sentences occupy so filler windows
  // never re-quote text a takeaway already says.
  const markUsed = (s) => {
    const toks = cleanWords(s.t);
    if (toks.length < 4) return;
    const target = toks.join(' ').toLowerCase();
    for (let i = 0; i + toks.length <= bodyWords.length; i++) {
      if (bodyWords.slice(i, i + toks.length).join(' ').toLowerCase() === target) {
        fitState.taken.push({ start: i, count: toks.length });
        return;
      }
    }
  };
  pool.slice(0, 3).forEach(markUsed);

  const takeaways = pool.slice(0, 3).map((s) => fitWords(s.t, n, bodyWords, fitState));
  const head8 = (s) => wordsOf(s.t).slice(0, 8).join(' ').toLowerCase();
  const usedHeads = new Set(pool.slice(0, 3).map(head8));
  let bulletSrc = pool.slice(3).filter((s) => !usedHeads.has(head8(s)));
  if (bulletSrc.length < bullets) bulletSrc = pool.slice(3); // thin article: allow reuse
  const points = bulletSrc.slice(0, bullets).map((s) => {
    const { phrase, consumed } = leadPhrase(s.t);
    const introCount = wordsOf(phrase).length; // the colon attaches to the last word
    const maxBody = Math.max(6, 25 - Math.max(2, introCount - 1));
    const rest = cleanWords(s.t).slice(consumed).join(' ');
    const bodyText = fitWords(rest || s.t, Math.min(maxBody, 25), bodyWords, fitState);
    return `• ${unicodeBold(phrase)} ${bodyText}`;
  });

  const lines = [
    unicodeBold(headingFrom(title) || 'Article Highlights'),
    '',
    unicodeBold('Key Takeaways:'),
    ...takeaways.map((t, i) => `${i + 1}. ${t}`),
    '',
    ...points,
    '',
    imageStatus(candidate),
  ];
  if (sourceLine) lines.push('', sourceLine);
  if (footer) lines.push('', footer.trim());
  return lines.join('\n');
}

/**
 * Machine quality check over the rendered post. Returns the list of failures;
 * empty means the post satisfies the spec (1 heading / exactly `takeaways`
 * numbered lines of exactly `takeawayWords` words / exactly `bullets`
 * bullets / 1 image line / source line present).
 */
export function qualityChecks(post, { takeawayWords = 25, takeaways = 3, bullets = 5, source = true } = {}) {
  const lines = String(post ?? '').split('\n');
  const failures = [];
  const numbered = lines.filter((l) => /^\d+\.\s+\S/.test(l));
  const bulleted = lines.filter((l) => /^[•\u2022]\s+\S/.test(l));
  const imageLines = lines.filter((l) => /^Article image:/i.test(l));

  if (numbered.length !== takeaways) failures.push(`need ${takeaways} numbered takeaways, have ${numbered.length}`);
  numbered.forEach((l, i) => {
    const w = wordsOf(l.replace(/^\d+\.\s+/, '')).length;
    if (w !== takeawayWords) failures.push(`takeaway ${i + 1} has ${w} words (need ${takeawayWords})`);
  });
  if (bulleted.length !== bullets) failures.push(`need ${bullets} bullets, have ${bulleted.length}`);
  if (imageLines.length !== 1) failures.push(`need 1 image line, have ${imageLines.length}`);
  if (source) {
    const sourceLines = lines
      .map((l) => l.replace(/^🔗\s*/, '').trim())
      .filter((l) => /^(?:source|full article):/i.test(l) && /https?:\/\//i.test(l));
    if (sourceLines.length !== 1) failures.push(`need 1 source URL line, have ${sourceLines.length}`);
  }
  if (!lines[0]?.trim()) failures.push('heading missing');
  return failures;
}

let lastFailures = [];

async function llmJson({ title, body, cfg, failures = [], log }) {
  const llm = cfg?.llm ?? {};
  const key = readKey(llm);
  if (key === null) return null;
  const base = (llm.baseUrl ?? DEFAULT_LLM.baseUrl).replace(/\/+$/, '');
  const t = cfg?.template ?? {};
  const n = Number(t.takeawayWords) || 25;

  const system =
    'You turn articles into structured LinkedIn posts. Reply with ONLY a JSON object: ' +
    `{"heading": string, "takeaways": [3 strings, each EXACTLY ${n} words], ` +
    `"bullets": [5 strings of at most 20 words], "imageStatus": string}. ` +
    'heading: one concise engaging line about the article\'s central subject, no clickbait, no emoji. ' +
    `takeaways: the 3 most important insights, numbered by array order, each exactly ${n} words — count them. ` +
    'bullets: distinct facts, arguments, examples or implications; do not repeat the takeaways verbatim; ' +
    'write each as "Short Intro Phrase - rest of the point" (the intro phrase becomes bold). ' +
    'Use ONLY facts stated in the article; never invent claims. ' +
    'imageStatus: describe where the cover comes from or say it was unavailable; never invent an image URL. ' +
    'No URLs inside heading/takeaways/bullets. No hashtags.';
  const user = [
    `Article title: ${title ?? ''}`,
    body.slice(0, 9000),
    failures.length ? `\nYour last attempt FAILED these checks — fix them:\n- ${failures.join('\n- ')}` : '',
  ].filter(Boolean).join('\n\n');

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  // src/chat.js rotates model + fallbackModels and waits out free-tier 429s;
  // providers that reject response_format/temperature still get JSON because
  // the relaxed body and the prompt itself demand a bare object.
  const res = await chatCompletion({
    llm,
    base,
    key,
    log,
    label: 'rewrite',
    buildBody: (model) => ({
      body: {
        model,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages,
        ...(llm.maxTokens ? { max_tokens: llm.maxTokens } : {}),
      },
      relaxBody: { model, messages },
    }),
  });
  if (!res?.text) return null;
  const cleaned = res.text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    log?.('[rewrite] LLM reply was not valid JSON — using fallback.');
    return null;
  }
}

/** Render the LLM JSON into the same layout the extractive engine produces. */
function renderTemplateJson(json, { takeawayWords = 25, sourceLine = '', footer = '', candidate = {} } = {}) {
  const takeaways = (Array.isArray(json?.takeaways) ? json.takeaways : [])
    .slice(0, 3)
    .map((t) => fitWords(t, takeawayWords));
  const points = (Array.isArray(json?.bullets) ? json.bullets : [])
    .slice(0, 5)
    .map((b) => {
      const m = String(b).match(/^(.{2,40}?)(?:\s[-–—:]\s+|\s-\s)(.+)$/);
      // Same bold-intro derivation as the extractive path (leadPhrase caps at
      // 4 title-cased words and appends the colon). titleCasePhrase, referenced
      // here before, never existed — the LLM render path only now has a key.
      const intro = leadPhrase(m ? m[1] : String(b)).phrase;
      const rest = m ? m[2].trim() : cleanWords(String(b)).slice(1).join(' ');
      return `• ${unicodeBold(intro)} ${rest}`;
    });
  const img = json?.imageStatus
    ? `Article image: ${String(json.imageStatus).replace(/^article image:\s*/i, '')}`
    : imageStatus(candidate);

  const lines = [
    unicodeBold(String(json?.heading ?? '').replace(/[*_#]/g, '').trim() || 'Article Highlights'),
    '',
    unicodeBold('Key Takeaways:'),
    ...takeaways.map((t, i) => `${i + 1}. ${t}`),
    '',
    ...points,
    '',
    img,
  ];
  if (sourceLine) lines.push('', sourceLine);
  if (footer) lines.push('', footer.trim());
  return lines.join('\n');
}

/** Attribution wording. A blank field falls back to the default rather than
 *  silently dropping the link — `attribution: false` is the off switch. */
function creditTemplate(cfg) {
  const t = cfg?.attributionText;
  return typeof t === 'string' && t.trim() ? t : '🔗 Full article: {url}';
}

/**
 * Structured rewrite for one candidate. Returns the finished post text;
 * never throws — LLM failures/regeneration limits fall back to the
 * deterministic extractive builder, which always satisfies the spec.
 */
async function templatePost(candidate, cfg, log) {
  const title = candidate.text.split('\n')[0] ?? '';
  const body = candidate.text.slice(title.length).trim();
  const t = cfg?.template ?? {};
  const takeawayWords = Number(t.takeawayWords) || 25;
  const bullets = Number(t.bullets) || 5;
  const mode = cfg?.mode ?? 'auto';

  let sourceLine = '';
  if (cfg?.attribution !== false && candidate.articleUrl) {
    const credit = creditTemplate(cfg);
    sourceLine = credit.replace('{url}', candidate.articleUrl);
  }

  const extractive = () =>
    buildExtractiveTemplate({
      title,
      body,
      candidate,
      takeawayWords,
      bullets,
      sourceLine,
      footer: t.footer ?? '',
    });

  if (mode === 'llm' || mode === 'auto') {
    for (let attempt = 0; attempt < 2; attempt++) {
      let json = null;
      try {
        json = await llmJson({ title, body, cfg, failures: attempt ? lastFailures : [], log });
      } catch (err) {
        if (mode === 'llm') log(`[rewrite] LLM failed (${err.message}).`);
        break;
      }
      if (!json) break;
      const post = renderTemplateJson(json, { takeawayWords, sourceLine, footer: t.footer ?? '', candidate });
      const failures = qualityChecks(post, { takeawayWords, bullets, source: Boolean(sourceLine) });
      if (!failures.length) {
        log('[rewrite] LLM structured template used (quality checks passed).');
        return post;
      }
      lastFailures = failures;
      log(`[rewrite] Template validation failed: ${failures.join('; ')} — regenerating.`);
    }
  }

  const post = extractive();
  const failures = qualityChecks(post, { takeawayWords, bullets, source: Boolean(sourceLine) });
  if (failures.length) log(`[rewrite] extractive template still off-spec: ${failures.join('; ')}`);
  else log('[rewrite] Extractive structured template used (quality checks passed).');
  return post;
}

/** Split a feed candidate's text into its title line and body. */
export function splitTitleBody(candidate) {
  const title = candidate.text.split('\n')[0] ?? '';
  return { title, body: candidate.text.slice(title.length).trim() };
}

/**
 * Rewrite a candidate for posting. Returns the new text; never throws —
 * falls back to extractive (then to the original text) on any failure.
 */
export async function rewriteForPost(candidate, cfg, log) {
  const enabled = cfg?.enabled !== false;
  if (!enabled || !candidate.summarize) return candidate.text;

  if (cfg?.template?.enabled !== false) {
    return templatePost(candidate, cfg, log);
  }

  const { title, body } = splitTitleBody(candidate);
  const opts = { targetChars: cfg?.targetChars ?? 900, maxSentences: cfg?.maxSentences ?? 7 };
  const mode = cfg?.mode ?? 'auto';

  let text = null;
  if (mode === 'llm' || mode === 'auto') {
    try {
      text = await legacyLlmPost({ title, body, articleUrl: candidate.articleUrl, cfg, log });
      if (text && mode === 'auto') log('[rewrite] LLM rewrite used.');
    } catch (err) {
      if (mode === 'llm') log(`[rewrite] LLM failed (${err.message}) — extractive fallback.`);
      text = null;
    }
  }
  if (!text) {
    text = extractivePost(title, body, opts);
    log(`[rewrite] Extractive summary used (${text.length} chars).`);
  }
  if (!text) return candidate.text;

  if (cfg?.attribution !== false && candidate.articleUrl) {
    const credit = creditTemplate(cfg);
    text += `\n\n${credit.replace('{url}', candidate.articleUrl)}`;
  }
  return text;
}

async function legacyLlmPost({ title, body, articleUrl, cfg, log }) {
  const llm = cfg?.llm ?? {};
  const key = readKey(llm);
  if (key === null) return null;
  const base = (llm.baseUrl ?? DEFAULT_LLM.baseUrl).replace(/\/+$/, '');
  const target = Number(cfg?.targetChars) || 900;

  const messages = [
    {
      role: 'system',
      content:
        'You rewrite articles as short LinkedIn posts. Output ONLY the post text: ' +
        `about ${target} characters, short paragraphs, plain text, no hashtags, ` +
        'no headings, no URLs or links, no emojis unless natural, no meta commentary. Keep the '
        + "author's key points and voice; do not add claims that are not in the article.",
    },
    {
      role: 'user',
      content: `Article${articleUrl ? ` (source: ${articleUrl})` : ''}:\n\n${`${title ?? ''}\n\n${body ?? ''}`.slice(0, 9000)}`,
    },
  ];
  const res = await chatCompletion({
    llm,
    base,
    key,
    log,
    label: 'rewrite',
    buildBody: (model) => ({
      body: {
        model,
        temperature: 0.7,
        messages,
        ...(llm.maxTokens ? { max_tokens: llm.maxTokens } : {}),
      },
      relaxBody: { model, messages },
    }),
  });
  return res?.text?.trim() || null;
}
