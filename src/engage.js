import { guardAuth, screenshot } from './browser.js';
import { generateComment, fallbackComment, llmAvailable } from './comment.js';

/**
 * Outbound engagement: on each scheduled run, find a good post to engage with
 * on OTHER people's content — either from a set of configured handles' recent
 * activity, or from the auto-refreshed home feed filtered by keywords — pick
 * the best-engaged (and recent) candidate we have not already engaged, open
 * it, like it, and leave a short tailored comment. "Only once": each post is
 * engaged at most once ever (tracked in the ledger) and at most
 * engagement.maxPerRun posts are touched per run (default 1).
 *
 * This NEVER throws except on AuthError (which the runner must react to);
 * every other failure returns a partial result and is logged as a warning.
 *
 * 2026 LinkedIn DOM anchors (reused from the scraper):
 *   post container : [data-view-name="feed-full-update"]
 *   post text      : [data-testid="expandable-text-box"]
 *   post permalink : a[href*="urn:li:activity:<id>"] (also share/ugcPost URNs)
 *   action bars    : plain <button> with visible "Like"/"Comment" text and a
 *                    state-only aria-label — match by text, not role/name.
 *   comment editor : on the post-detail page an always-present inline TipTap
 *                    box (contenteditable aria-label "Text editor for creating
 *                    comment"); its OWN send button lives in the composer
 *                    subtree (a page-wide "Comment" match hits the action-bar
 *                    toggle and silently discards the draft — the old bug).
 */

const FEED_URL = 'https://www.linkedin.com/feed/';
const POST_ROOT = '[data-view-name="feed-full-update"]';
const TEXT_BOX = '[data-testid="expandable-text-box"]';

const DEFAULTS = {
  enabled: false,
  like: true,
  commentMode: 'ai', // 'ai' | 'pool' | 'fixed' | 'none'
  text: '',
  pool: [],
  handles: [], // linkedin usernames or /in/ URLs to engage
  keywords: [], // feed keyword filter (case-insensitive substring)
  pickStrategy: 'top', // 'top' | 'recent' | 'topRecent'
  maxPerRun: 1,
  feedScrolls: 6,
  minDelayMs: 3000,
  maxDelayMs: 12000,
  llm: null, // defaults to the rewrite LLM block when unset (passed by run.js)
};

/** "1.2K" -> 1200, "45" -> 45, undefined -> 0. */
function parseCount(s) {
  const m = String(s ?? '').match(/([\d.,]+)\s*([km])?/i);
  if (!m) return 0;
  let n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  const unit = (m[2] ?? '').toLowerCase();
  if (unit === 'k') n *= 1000;
  else if (unit === 'm') n *= 1_000_000;
  return Math.round(n);
}

/** Accept "handle", "linkedin.com/in/handle", or a full recent-activity URL. */
function normalizeHandle(h) {
  let s = String(h ?? '').trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  let name;
  const m = s.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (m) name = decodeURIComponent(m[1]);
  else if (/^in\//i.test(s)) name = decodeURIComponent(s.split('/')[1] ?? '').split('?')[0];
  else name = s.split(/[/?#]/)[0];
  if (!name || /your-handle/i.test(name)) return null;
  return { name, recentUrl: `https://www.linkedin.com/in/${name}/recent-activity/all/` };
}

async function humanDelay(page, cfg) {
  const lo = Number(cfg.minDelayMs) || 3000;
  const hi = Math.max(lo, Number(cfg.maxDelayMs) || lo);
  await page.waitForTimeout(lo + Math.random() * (hi - lo));
}

/** Scrape the posts currently rendered on the page (text, urn, author, counts). */
async function scrapePosts(page) {
  return page.evaluate(
    ({ POST_ROOT, TEXT_BOX }) =>
      [...document.querySelectorAll(POST_ROOT)].map((root) => {
        const textEl = root.querySelector(TEXT_BOX);
        const text = textEl ? (textEl.innerText || '').trim() : '';
        const hrefs = [...root.querySelectorAll('a[href*="urn:li:"]')].map((a) => a.href);
        const um = hrefs.map((h) => (h.match(/urn:li:(?:activity|share|ugcPost):\d+/) || [null])[0]).find(Boolean);
        const authorA = [...root.querySelectorAll('a[href*="/in/"], a[href*="/showcase/"], a[href*="/company/"]')].find(
          (a) => (a.innerText || '').trim(),
        );
        const counts = root.innerText || '';
        const r = counts.match(/([\d.,]+\s*[km]?)\s+reactions/i);
        const c = counts.match(/([\d.,]+\s*[km]?)\s+comments?/i);
        return {
          text,
          urn: um,
          author: authorA ? (authorA.innerText || '').trim().split('\n')[0] : '',
          reactions: r ? r[1] : '',
          comments: c ? c[1] : '',
        };
      }),
    { POST_ROOT, TEXT_BOX },
  );
}

/** Navigate to a page, nudge lazy-loading, and return normalized candidates. */
async function collectFrom(page, url, log, label, scrolls = 3) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await guardAuth(page);
    await page.waitForSelector(POST_ROOT, { timeout: 20000 }).catch(() => {});
    for (let i = 0; i < scrolls; i++) {
      await page.mouse.wheel(0, 1600).catch(() => {});
      await page.waitForTimeout(1400);
    }
    const raw = await scrapePosts(page);
    const out = raw
      .filter((p) => p.urn && p.text)
      .map((p) => ({
        urn: p.urn,
        url: `https://www.linkedin.com/feed/update/${p.urn}/`,
        text: p.text,
        author: p.author,
        reactions: parseCount(p.reactions),
        comments: parseCount(p.comments),
      }));
    log(`[engage] ${label}: ${out.length} post(s) scraped.`);
    return out;
  } catch (err) {
    const { AuthError } = await import('./browser.js');
    if (err instanceof AuthError) throw err;
    log(`[engage] ${label} scrape failed: ${err.message}`);
    return [];
  }
}

/** Rank by total engagement; 'recent' keeps feed order; 'topRecent' = best of the newest 10. */
function pickPosts(cands, strategy, max) {
  const score = (p) => p.reactions + p.comments * 2; // comments weigh a little more
  let ordered;
  if (strategy === 'recent') ordered = cands;
  else if (strategy === 'topRecent') ordered = [...cands.slice(0, 10)].sort((a, b) => score(b) - score(a));
  else ordered = [...cands].sort((a, b) => score(b) - score(a));
  return ordered.slice(0, Math.max(1, Number(max) || 1));
}

async function likePost(page, cfg, log, out) {
  const post = page.locator('main').first();
  const likeBtn = post.locator('button', { hasText: /^like$/i }).first();
  if (!(await likeBtn.count().catch(() => 0))) {
    log('[engage] Like button not found on the post — skipped like.');
    return;
  }
  const label = (await likeBtn.getAttribute('aria-label').catch(() => '')) ?? '';
  if (/state:\s*(?!no reaction)\w/i.test(label)) {
    out.liked = true;
    log(`[engage] post already reacted (${label}) — skipped like.`);
    return;
  }
  await likeBtn.click({ timeout: 15000 });
  out.liked = true;
  log('[engage] ✔ liked');
}

async function commentPost(page, cfg, log, out, post) {
  let text = null;
  if (cfg.commentMode === 'ai') {
    text = await generateComment({ postText: post.text, authorName: post.author, llm: cfg.llm, log });
    if (!text) text = fallbackComment(cfg);
  } else {
    text = fallbackComment(cfg);
  }
  if (!text) {
    log('[engage] no comment text available (mode set but empty) — skipped comment.');
    return;
  }
  await humanDelay(page, cfg);

  const main = page.locator('main').first();
  // Focus the composer: on the detail page the inline editor already exists;
  // clicking the action-bar Comment just scrolls to it (harmless). On a
  // feed-style layout it opens a modal dialog instead.
  const commentBtn = main.locator('button', { hasText: /^comment$/i }).first();
  if (await commentBtn.count().catch(() => 0)) {
    await commentBtn.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }
  const dlg = page.getByRole('dialog').filter({ has: page.locator('[contenteditable="true"]') }).last();
  const scope = (await dlg.count().catch(() => 0)) ? dlg : main;
  const editor = scope
    .locator('[contenteditable="true"][aria-label*="comment" i], div.ql-editor, [contenteditable="true"]')
    .last();
  await editor.waitFor({ state: 'attached', timeout: 15000 });
  // TipTap only accepts typed text once a real click places the caret.
  await editor
    .click({ force: true, timeout: 8000 })
    .catch(async () => {
      await editor.evaluate((el) => el.focus()).catch(() => {});
    });
  await page.waitForTimeout(400);
  await page.keyboard.type(text, { delay: 20 });
  await page.waitForTimeout(600);
  const typed = (await editor.innerText().catch(() => '')) ?? '';
  const want = text.replace(/\s+/g, '').slice(0, 24);
  if (!typed.replace(/\s+/g, '').includes(want)) {
    throw new Error(`comment text did not enter the editor (saw "${typed.trim().slice(0, 40)}") — aborted to avoid an empty comment`);
  }
  await humanDelay(page, cfg);
  // Submit via the editor's OWN composer send button (climb from the editor),
  // never a page-wide "Comment" match (that hits the action-bar toggle).
  const sent = await editor
    .evaluate((el) => {
      let box = el;
      for (let i = 0; i < 8 && box; i++) {
        box = box.parentElement;
        if (!box) break;
        const btns = [...box.querySelectorAll('button')].filter((b) =>
          /^(comment|post|submit|post comment)$/i.test((b.innerText || '').trim())
        );
        if (btns.length) {
          btns[btns.length - 1].click();
          return true;
        }
      }
      return false;
    })
    .catch(() => false);
  if (!sent) throw new Error('comment editor opened but no send button appeared');
  await page.waitForTimeout(3500);
  const cleared = ((await editor.innerText().catch(() => 'x')) ?? 'x').trim() === '';
  const inThread = await page
    .locator('li')
    .filter({ hasText: text.slice(0, 24) })
    .count()
    .catch(() => 0);
  if (cleared || inThread > 0) {
    out.commented = true;
    out.commentText = text.slice(0, 240);
    log(`[engage] ✔ commented${inThread ? ' (visible in thread)' : ' (editor cleared)'}: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`);
  } else {
    throw new Error('clicked send but comment did not appear — treated as failed');
  }
}

async function engageOne(page, post, cfg, log) {
  const out = { liked: false, commented: false };
  log(`[engage] targeting post by ${post.author || 'unknown'} (${post.reactions}👍 ${post.comments}💬): ${post.url}`);
  await page.goto(post.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await guardAuth(page); // AuthError propagates — runner pauses the schedule
  const main = page.locator('main').first();
  const like = main.locator('button', { hasText: /^like$/i }).first();
  const deadline = Date.now() + 25000;
  let ready = false;
  while (Date.now() < deadline) {
    if ((await like.count().catch(() => 0)) > 0) {
      ready = true;
      break;
    }
    await page.waitForTimeout(1000);
  }
  if (!ready) {
    log('[engage] post opened but no action bar appeared — skipped.');
    return out;
  }
  await page.waitForTimeout(800);
  if (cfg.like) await likePost(page, cfg, log, out);
  if (cfg.commentMode !== 'none') await commentPost(page, cfg, log, out, post);
  return out;
}

/**
 * Main entry. Returns { attempted, liked, commented, postUrl, author, commentText, error }.
 * run.js passes `ledger` (for once-ever dedupe) and `llm` (comment model config).
 */
export async function engageFeed(page, { cfg: rawCfg, ledger, llm, log }) {
  const cfg = { ...DEFAULTS, ...(rawCfg ?? {}) };
  if (llm && !rawCfg?.llm) cfg.llm = llm;
  const out = { attempted: false, liked: false, commented: false, postUrl: null, author: null, commentText: null, error: null };
  try {
    const handles = (cfg.handles ?? []).map(normalizeHandle).filter(Boolean);
    const keywords = (cfg.keywords ?? []).map((k) => String(k).trim().toLowerCase()).filter(Boolean);
    if (!handles.length && !keywords.length) {
      log('[engage] no handles or keywords configured — nothing to engage.');
      return out;
    }
    out.attempted = true;
    if (cfg.commentMode === 'ai' && !llmAvailable(cfg.llm)) {
      log('[engage] comment mode is "ai" but no free LLM key on this Mac — falling back to pool/fixed. Run `npm run llm:setup` (Gemini free tier) for tailored comments.');
    }

    let pool = [];
    for (const h of handles) pool.push(...(await collectFrom(page, h.recentUrl, log, `@${h.name} recent-activity`, 3)));
    if (keywords.length) pool.push(...(await collectFrom(page, FEED_URL, log, 'home feed', Math.max(1, Number(cfg.feedScrolls) || 6))));

    // Dedupe by URN, keep scrape order (feed/handle order ≈ newest first).
    const seen = new Set();
    let cands = [];
    for (const p of pool) {
      if (!p.urn || seen.has(p.urn)) continue;
      seen.add(p.urn);
      cands.push(p);
    }
    if (keywords.length) cands = cands.filter((p) => keywords.some((k) => p.text.toLowerCase().includes(k)));
    if (ledger) cands = cands.filter((p) => !ledger.isEngaged(p.urn));

    if (!cands.length) {
      const shot = await screenshot(page, 'engage-no-candidates');
      throw new Error(`no eligible posts to engage (scraped ${pool.length}, all filtered or already engaged). Screenshot: ${shot ?? 'n/a'}`);
    }

    const picked = pickPosts(cands, cfg.pickStrategy, cfg.maxPerRun);
    log(`[engage] ${cands.length} eligible post(s); engaging ${picked.length} via "${cfg.pickStrategy}".`);
    for (const post of picked) {
      const one = await engageOne(page, post, cfg, log);
      out.liked = out.liked || one.liked;
      out.commented = out.commented || one.commented;
      out.postUrl = post.url;
      out.author = post.author || null;
      out.commentText = one.commented ? one.commentText ?? out.commentText : out.commentText;
      if (one.liked || one.commented) ledger?.markEngaged(post.urn, { author: post.author, url: post.url });
    }
    if (!out.liked && !out.commented) throw new Error('picked a post but neither like nor comment succeeded');
    return out;
  } catch (err) {
    const { AuthError } = await import('./browser.js');
    if (err instanceof AuthError) throw err;
    out.error = String(err?.message ?? err).slice(0, 400);
    log(`[engage] WARNING — engagement failed (run result unaffected): ${out.error}`);
    return out;
  }
}

/** Dry-run planning: what would engagement do, without touching the browser. */
export function planEngagement(engCfg, llm) {
  const cfg = { ...DEFAULTS, ...(engCfg ?? {}) };
  const handles = (cfg.handles ?? []).map(normalizeHandle).filter(Boolean).map((h) => h.name);
  const keywords = (cfg.keywords ?? []).map((k) => String(k).trim()).filter(Boolean);
  const comment =
    cfg.commentMode === 'none'
      ? null
      : cfg.commentMode === 'ai'
        ? llmAvailable(llm)
          ? `AI via ${llm?.model ?? 'the configured model'} (tailored to each post)`
          : 'AI requested but no key on this Mac — pool/fixed fallback (`npm run llm:setup`)'
        : fallbackComment(cfg)
          ? `${cfg.commentMode} comment`
          : `${cfg.commentMode} (no text configured)`;
  return { handles, keywords, like: cfg.like, comment, strategy: cfg.pickStrategy, maxPerRun: Math.max(1, Number(cfg.maxPerRun) || 1) };
}
