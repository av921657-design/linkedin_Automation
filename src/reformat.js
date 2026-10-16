/**
 * Reformat engine: applies the template rules from config.json's
 * `reformat` block to raw source text.
 *
 * Pipeline: normalize newlines -> strip scraped "… more" artifact -> cut
 * signature footer (config.cutFromMarkers) -> collapse blank lines ->
 * prepend/append -> style template (hook / paragraph re-break / CTA) ->
 * source credit ("Source @handle") ->
 * hashtags (manual first, then random picks from the pool) ->
 * length cap (the hashtag line is reserved so truncation never eats it).
 */

const DEFAULT_CUT_MARKERS = ['✍'];

/**
 * Safety-net pool, used only if config.json's autoHashtags.pool is missing
 * or empty. The live, user-curated list of ~190 tags lives in config.json.
 */
export const DEFAULT_TAG_POOL = [
  'Business', 'Entrepreneurship', 'Leadership', 'Innovation', 'Technology',
  'Marketing', 'Networking', 'Success', 'Motivation', 'Careers',
  'ArtificialIntelligence', 'DigitalMarketing', 'PersonalBranding', 'StartupIndia',
  'SupplyChain', 'Logistics', 'ProjectManagement', 'FutureOfWork', 'GrowthMindset',
  'WorkLifeBalance', 'Sales', 'Finance', 'India', 'LinkedInIndia',
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Remove LinkedIn's trailing "… more" / "... more" / "see more" UI artifact. */
export function stripSeeMore(text) {
  const lines = String(text ?? '').split('\n');
  const artifact = /^\s*(?:(?:…|\.{2,3})\s*more|see\s+more)\s*$/i;
  while (lines.length && artifact.test(lines[lines.length - 1])) lines.pop();
  return lines.join('\n').trimEnd();
}

/** Cut everything from the first signature marker line to the end. */
function cutAtMarkers(text, markers) {
  let cut = text.length;
  for (const m of markers) {
    const idx = text.search(new RegExp(`^[^\\S\\n]*${escapeRe(m)}`, 'm'));
    if (idx !== -1 && idx < cut) cut = idx;
  }
  return text.slice(0, cut).trimEnd();
}

/** Bare hashtag name from "#SupplyChain", "SupplyChain" or stray scrape text. */
function tagName(t) {
  return String(t).replace(/^#/, '').replace(/[^\p{L}\p{N}]/gu, '');
}

function cleanKey(t) {
  return tagName(t).toLowerCase();
}

/**
 * Hashtags for one post: a random total count in [min, max] (inclusive),
 * sampled without replacement from the pool — the post text does not
 * influence the choice, and the pool order is shuffled per post so the same
 * tags don't always lead. `exclude` (manual tags) count toward the total and
 * are never repeated.
 */
export function randomHashtags({ pool = DEFAULT_TAG_POOL, min = 10, max = 15, exclude = [] } = {}) {
  const used = new Set(exclude.map(cleanKey).filter(Boolean));
  const candidates = [];
  for (const p of pool) {
    const name = tagName(p);
    if (!name) continue;
    const key = name.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);
    candidates.push(name);
  }

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  let lo = Math.max(1, Number(min) || 10);
  let hi = Math.max(1, Number(max) || 15);
  if (hi < lo) lo = hi; // a stricter max wins over a wider min
  const total = lo + Math.floor(Math.random() * (hi - lo + 1));
  const need = total - exclude.length;
  if (need <= 0) return [];
  return candidates.slice(0, need).map((n) => `#${n}`);
}

const TAG_STOPWORDS = new Set([
  'of', 'and', 'the', 'for', 'with', 'your', 'you', 'our', 'we', 'to', 'in',
  'on', 'a', 'an', 'india', // 'india' stays meaningful only inside a tag name
]);

/**
 * Relevance hashtags for article rewrites (substack/medium): score every tag
 * in the curated pool against the article text — CamelCase names are split
 * into words ("DigitalMarketing" -> digital + marketing), a word counts when
 * it appears as a whole word in the article (acronym tags like "AI" match
 * case-sensitively). Top `count` scores win; remaining slots are filled with
 * random pool picks so the line always has `count` tags. The pool stays the
 * user's curated list — only the selection is content-aware.
 */
export function relevantHashtags({ pool = DEFAULT_TAG_POOL, text = '', count = 10, exclude = [] } = {}) {
  const used = new Set(exclude.map(cleanKey).filter(Boolean));
  const lower = ` ${String(text ?? '').toLowerCase()} `;
  const upper = String(text ?? '');

  const scored = [];
  for (const p of pool) {
    const name = tagName(p);
    if (!name || used.has(name.toLowerCase())) continue;
    const camel = name.split(/(?=[A-Z0-9])/).filter((w) => w.length > 1);
    // Acronym-style / digit tags ("AI", "B2B", "FinTech"->Fin+Tech) stay whole
    // when CamelCase splitting would shred them.
    const parts = camel.length > 1 ? camel : [name];
    let score = 0;
    for (const w of parts) {
      if (TAG_STOPWORDS.has(w.toLowerCase())) continue;
      const lw = w.toLowerCase();
      const inText = lower.includes(` ${lw} `) || (lw.length > 3 && lower.includes(` ${lw.replace(/s$/, '')} `));
      if (/^[A-Z][a-z]+$/.test(w)) {
        if (inText) score += 1; // Marketing / startups (singular match ok)
      } else if (/^[A-Z0-9]{2,}$/.test(w)) {
        if (new RegExp(`\\b${w}\\b`).test(upper)) score += 2; // AI, SEO, B2B
      } else if (w.length > 2 && inText) {
        score += 1;
      }
    }
    scored.push({ name, score });
  }

  const wanted = Math.max(1, Number(count) || 10);
  const rankedTags = scored
    .map((s) => ({ ...s, r: Math.random() }))
    .sort((a, b) => b.score - a.score || b.r - a.r);
  // Keep the tag line under ~255 chars so reformat's length cap never
  // truncates the article body; best-scoring tags win, longest ones drop.
  const take = (list, filterLong, already = []) => {
    const out = [...already];
    let len = out.reduce((n, t) => n + t.name.length + 1, 0);
    for (const s of list) {
      if (out.length >= wanted || len > 255) break;
      if (filterLong && s.name.length > 24) continue;
      out.push(s);
      len += s.name.length + 1;
    }
    return out;
  };
  let chosen = take(rankedTags.filter((s) => s.score > 0), true);
  if (chosen.length < wanted) chosen = take(rankedTags.filter((s) => s.score > 0), false, chosen);

  if (chosen.length < wanted) {
    const usedKeys = new Set(chosen.map((s) => s.name.toLowerCase()));
    chosen = take(
      rankedTags.filter((s) => !usedKeys.has(s.name.toLowerCase())),
      chosen.length >= wanted - 3, // allow long filler tags only near the end
      chosen,
    );
  }
  return chosen.map((s) => `#${s.name}`);
}

/**
 * Merge a source's reformat overrides over the global defaults.
 * Scalars and arrays (prepend, append, cutFromMarkers, hashtags, maxChars…)
 * are replaced by the override; autoHashtags and style are merged key-by-key
 * so a source can, e.g., set its own pool without redefining min/max.
 */
export function mergeReformat(base, override) {
  const merged = { ...(base ?? {}) };
  if (!override || typeof override !== 'object') return merged;
  for (const [k, v] of Object.entries(override)) {
    if (k === 'autoHashtags' || k === 'style') {
      merged[k] = { ...(merged[k] ?? {}), ...v };
    } else {
      merged[k] = v;
    }
  }
  return merged;
}

/**
 * Break long paragraphs into groups of at most `max` sentences so posts read
 * in short LinkedIn-friendly chunks. Lines that are already short, start with
 * '#', or don't look like prose are left untouched.
 */
function rebalanceParagraphs(text, max) {
  const n = Number(max) || 0;
  if (n < 1) return text;
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.length < 120) return line;
      const sentences = t.split(/(?<=[.!?…])\s+(?=["'“(\[]?[A-Z0-9])/u);
      if (sentences.length <= n) return line;
      const groups = [];
      for (let i = 0; i < sentences.length; i += n) {
        groups.push(sentences.slice(i, i + n).join(' '));
      }
      return groups.join('\n\n');
    })
    .join('\n');
}

export function reformat(raw, cfg) {
  const c = cfg ?? {};
  let text = String(raw ?? '').replace(/\r\n/g, '\n').trim();

  // Scrape chrome: the "… more" expand link and the account's signature
  // footer are never part of the repost.
  text = stripSeeMore(text);
  const markers = (Array.isArray(c.cutFromMarkers) ? c.cutFromMarkers : DEFAULT_CUT_MARKERS)
    .map((m) => String(m).trim())
    .filter(Boolean);
  if (markers.length && text) text = cutAtMarkers(text, markers);
  text = stripSeeMore(text);

  if (c.collapseBlankLines !== false) {
    text = text.replace(/\n{3,}/g, '\n\n');
  }

  const parts = [];
  if (c.prepend && c.prepend.trim()) parts.push(c.prepend.trim());
  if (text) parts.push(text);
  if (c.append && c.append.trim()) parts.push(c.append.trim());
  let body = parts.join('\n\n');

  // Style template: hook line on top, sentence-balanced paragraphs, CTA at
  // the bottom (hashtags are still appended after this block).
  const style = c.style ?? {};
  if (style.hook && String(style.hook).trim()) {
    body = `${String(style.hook).trim()}\n\n${body}`;
  }
  body = rebalanceParagraphs(body, style.sentencesPerParagraph);
  // The closing CTA is a reserved footer line (built below), not body text,
  // so maxChars truncation can never eat it.
  const ctaLine = style.cta && String(style.cta).trim() ? String(style.cta).trim() : '';

  // Source credit: `sourceHandle` is set per candidate by the runner (e.g.
  // "@some-handle" for a LinkedIn repost); creditLabel is the wording (default
  // "Source"). Sits after the body, before the hashtag line — and its space is
  // reserved below, so truncation never eats it. Off with creditSource:false
  // (global or per-source).
  let credit = '';
  if (c.creditSource !== false && c.sourceHandle && String(c.sourceHandle).trim()) {
    // Only a missing label defaults to "Source" — clearing the field to '' is
    // how the dashboard asks for a bare "@handle" with no prefix.
    const label = c.creditLabel == null ? 'Source' : String(c.creditLabel).trim();
    credit = `${label} ${String(c.sourceHandle).trim()}`.trim();
  }

  // Hashtags: manual list first, then random pool picks up to autoHashtags.max.
  const manual = (Array.isArray(c.hashtags) ? c.hashtags : [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`));
  const auto = c.autoHashtags ?? {};
  const picked =
    auto.enabled === false
      ? []
      : auto.source === 'relevance'
        ? relevantHashtags({
            pool: Array.isArray(auto.pool) && auto.pool.length ? auto.pool : DEFAULT_TAG_POOL,
            text: raw,
            count: auto.count ?? auto.min ?? auto.max ?? 10,
            exclude: manual,
          })
        : randomHashtags({
            pool: Array.isArray(auto.pool) && auto.pool.length ? auto.pool : DEFAULT_TAG_POOL,
            min: auto.min,
            max: auto.max,
            exclude: manual,
          });
  const tagLine = [...manual, ...picked].join(' ');

  const max = Number(c.maxChars) || 3000;
  // Footer lines (CTA, credit, hashtags) are reserved so body truncation
  // never eats them. Assembly order: body, CTA, credit, tags.
  const footer = [ctaLine, credit, tagLine].filter(Boolean);
  const reserve = footer.length ? footer.reduce((n, l) => n + l.length + 2, 0) : 0;
  const budget = Math.max(0, max - reserve);
  if (body.length > budget) {
    body = `${body.slice(0, Math.max(0, budget - 1)).trimEnd()}…`;
  }
  text = [body, ...footer].filter(Boolean).join('\n\n') || tagLine;

  if (text.length > max) {
    text = `${text.slice(0, max - 1).trimEnd()}…`;
  }

  return text;
}
