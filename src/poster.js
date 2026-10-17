import fs from 'node:fs';
import { DIRS } from './paths.js';
import { guardAuth, screenshot } from './browser.js';

const FEED_URL = 'https://www.linkedin.com/feed/';
// Direct composer route: works even when the feed's "Start a post" pill is inert.
const COMPOSER_URL = 'https://www.linkedin.com/sharing/compose';

export class PostError extends Error {
  constructor(message, screenshotPath = null) {
    super(message);
    this.name = 'PostError';
    this.screenshotPath = screenshotPath;
  }
}

/**
 * Publish one post via the feed composer (browser automation, no API).
 * mediaPaths: absolute paths to images/videos to attach (may be empty).
 * dryRun: performs every step except the final "Post" click, then discards.
 */
export async function postToLinkedIn(page, { text, mediaPaths = [] }, { dryRun = false, typeDelay = 25 } = {}) {
  await openFeed(page);
  let { editor, scope } = await findComposer(page);

  try {
    // Wait for the composer's async widgets before typing — see
    // waitComposerSettled for why (typing during hydration loses text).
    await waitComposerSettled(page, scope);

    // Attach media BEFORE typing text: any URL in the post text makes
    // LinkedIn build a link-preview card, and while a link attachment is
    // active the composer removes the "Media" button entirely — media must
    // go in first so the cover image wins and URLs stay plain text.
    if (mediaPaths.length > 0) {
      try {
        await attachMedia(page, scope, mediaPaths);
        // Attaching media re-renders the composer — re-resolve the editor
        // and dialog handles so typing doesn't hit a detached element.
        ({ editor, scope } = await findComposer(page));
      } catch (err) {
        // A text-only post beats a failed run: only give up when the missing
        // media is the video itself.
        if (mediaPaths.some((f) => /\.(mp4|mov|m4v|webm)$/i.test(f))) throw err;
        console.log('[poster] media attach failed — posting text only:', err.message);
      }
    }

    await editor.click();
    // LinkedIn's ProseMirror editor slows down as content grows (the hashtag
    // typeahead re-renders on every keystroke), so one pressSequentially over
    // the whole text has blown even generous per-char budgets on ~1k-char
    // posts. Type in chunks with per-chunk ceilings instead; a chunk that
    // still stalls is completed by an atomic fill().
    await typePostText(page, editor, text, typeDelay);

    // Guard against silent truncation: verify what the editor actually
    // holds, and repair once (atomic insert — immune to per-keystroke
    // races) if the editor dropped a chunk mid-text.
    await page.waitForTimeout(800);
    let seen = (await editor.innerText().catch(() => '')) ?? '';
    if (!textMatches(seen, text)) {
      await editor.fill(text).catch(() => {});
      await page.waitForTimeout(500);
      seen = (await editor.innerText().catch(() => '')) ?? '';
    }
    if (!textMatches(seen, text)) {
      const shot = await screenshot(page, 'text-truncated');
      throw new PostError(
        `Composer text looks truncated (expected ~${normalizeText(text).length} chars, saw ${normalizeText(seen).length}). Screenshot: ${shot ?? 'n/a'}`,
        shot
      );
    }

    const postButton = await waitUploadReady(page, scope, mediaPaths);

    if (dryRun) {
      await discardDraft(page, scope);
      return { ok: true, dryRun: true };
    }

    // Capture the new post's URN from the create response so the engagement
    // stage can open the EXACT post instead of hunting for it in a feed
    // (the fresh post often isn't on the algorithmic feed at all). Registered
    // before the click, because the response can land while the click awaits.
    let createdUrn = null;
    let urnInFlight = Promise.resolve();
    const captureUrn = (res) => {
      if (createdUrn) return;
      if (!/createUrn|\/feed\/nui\/create|rest\/li\/feed\/create|\/network\/update/i.test(res.url())) return;
      urnInFlight = res
        .json()
        .then((j) => {
          if (!j || createdUrn) return;
          const raw = `${j.activityReference || ''} ${j.id || ''} ${j.shareUrn || ''} ${j.contentUrl || ''}`;
          const m = raw.match(/urn:li:(?:activity|share|ugcPost):[\w-]+/);
          if (m) createdUrn = m[0];
        })
        .catch(() => {});
    };
    page.on('response', captureUrn);

    try {
      try {
        await postButton.click({ timeout: 45000 });
      } catch {
        // A transient overlay can swallow mouse clicks; keyboard activation
        // still reaches the button.
        const focused = await postButton
          .focus()
          .then(() => true)
          .catch(() => false);
        if (focused) await page.keyboard.press('Enter');
      }

      // Success signal: LinkedIn shows a toast; fall back to composer-closed check.
      let confirmed = false;
      try {
        await page.getByText(/post successful/i).first().waitFor({ state: 'visible', timeout: 15000 });
        confirmed = true;
      } catch {
        const editorGone = !(await editor.isVisible().catch(() => false));
        if (!editorGone) {
          const shot = await screenshot(page, 'post-unconfirmed');
          throw new PostError(`Post submitted but success not confirmed. Screenshot: ${shot ?? 'n/a'}`, shot);
        }
      }

      // The success toast can beat the create response body, so give the parse
      // a bounded moment before deciding the URN is unavailable.
      if (!createdUrn) await Promise.race([urnInFlight, page.waitForTimeout(3000)]);

      // Then a "View post" toast link as a second source for the URL.
      let postUrl = createdUrn ? `https://www.linkedin.com/feed/update/${createdUrn}/` : null;
      if (!postUrl) {
        try {
          await page.waitForTimeout(1500);
          const link = page.getByRole('link', { name: /view post|see post/i }).first();
          await link.waitFor({ state: 'attached', timeout: 4000 });
          const href = await link.getAttribute('href');
          if (href) postUrl = new URL(href, 'https://www.linkedin.com').href;
        } catch {
          /* no toast link — engagement will fall back to searching */
        }
      }

      return { ok: true, confirmed, dryRun: false, postUrl };
    } finally {
      page.off('response', captureUrn);
    }
  } catch (err) {
    if (err instanceof PostError) throw err;
    const shot = await screenshot(page, 'composer-failure');
    throw new PostError(`${err.message}${shot ? ` (screenshot: ${shot})` : ''}`, shot);
  }
}

async function openFeed(page) {
  await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await guardAuth(page);

  const startButton = page.getByRole('button', { name: /start a post|create a post/i }).first();
  await startButton.waitFor({ state: 'visible', timeout: 20000 }).catch(async () => {
    const shot = await screenshot(page, 'no-start-button');
    throw new PostError(`"Start a post" button not found (feed layout changed or session issue). Screenshot: ${shot ?? 'n/a'}`, shot);
  });
  await startButton.click();

  // The pill is no longer reliably clickable: on some accounts the synthetic
  // click lands (hit-testing confirms it) and LinkedIn simply does nothing.
  // Keyboard activation and the direct route both open the same composer, so
  // try all three before declaring the composer missing.
  if (await waitForEditor(page, 5000)) return;
  await startButton.focus().catch(() => {});
  await page.keyboard.press('Enter');
  if (await waitForEditor(page, 6000)) return;
  await page.goto(COMPOSER_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await waitForEditor(page, 8000);
}

/** Editors the composer has used so far, newest first. */
const EDITOR_SELECTORS = [
  '.tiptap.ProseMirror',
  '.ql-editor',
  'div.editor-content[contenteditable="true"]',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]',
];

/** Any visible composer editor on the page? */
async function visibleEditor(page) {
  for (const sel of EDITOR_SELECTORS) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  return null;
}

/** Poll for a visible editor for up to `ms`, or return null. */
async function waitForEditor(page, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const found = await visibleEditor(page);
    if (found) return found;
    await page.waitForTimeout(400);
  }
  return null;
}

/**
 * The composer renders asynchronously (spinner first), and LinkedIn stacks
 * several <dialog> elements. Poll for the editor across dialog scopes, then
 * the whole page, and return the editor plus its enclosing scope.
 */
async function findComposer(page) {
  const scopes = [page.getByRole('dialog'), page];
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    for (const scope of scopes) {
      for (const sel of EDITOR_SELECTORS) {
        const loc = scope.locator(sel).first();
        if (await loc.isVisible().catch(() => false)) {
          return { editor: loc, scope };
        }
      }
    }
    await page.waitForTimeout(500);
  }

  const shot = await screenshot(page, 'no-editor');
  const dialog = page.getByRole('dialog').first();
  const html = await dialog.evaluate((el) => el.outerHTML.slice(0, 20000)).catch(() => '');
  if (html) fs.writeFileSync(`${DIRS.logs}/composer-dom.html`, html);
  throw new PostError(`Composer editor did not appear within 15s (DOM dumped to logs/composer-dom.html). Screenshot: ${shot ?? 'n/a'}`, shot);
}

async function attachMedia(page, scope, files) {
  // Current composer: aria-label "Media". Keep older layouts as fallbacks.
  const labels = [/^media$/i, /^add media$/i, /^add a photo$/i, /^add photo$/i, /^add a video$/i, /^add video$/i];
  let addButton = null;
  for (const name of labels) {
    const candidate = scope.getByRole('button', { name }).first();
    if (await candidate.isVisible().catch(() => false)) {
      addButton = candidate;
      break;
    }
  }
  if (!addButton) {
    const shot = await screenshot(page, 'no-add-media');
    throw new PostError(`"Add media/photo/video" button not found in composer. Screenshot: ${shot ?? 'n/a'}`, shot);
  }

  const chooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
  await addButton.click();
  const chooser = await chooserPromise.catch(async () => {
    const shot = await screenshot(page, 'no-filechooser');
    throw new PostError(`File chooser did not open after clicking Add media. Screenshot: ${shot ?? 'n/a'}`, shot);
  });
  await chooser.setFiles(files);

  // Videos (and sometimes images) open LinkedIn's modal media "Editor"
  // (trim / captions) before the media lands in the composer. Its backdrop
  // covers the whole page, so the composer's Post button cannot be clicked
  // until "Next" is pressed — without this step every Post click gets
  // intercepted. No-op when the upload has no editor step.
  const isVideo = files.some((f) => /\.(mp4|mov|m4v|webm)$/i.test(f));
  const nextBtn = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('button', { name: /^next$/i }) })
    .getByRole('button', { name: /^next$/i })
    .first();
  try {
    await nextBtn.waitFor({ state: 'visible', timeout: isVideo ? 30000 : 6000 });
    await nextBtn.click({ timeout: 15000 });
    await nextBtn.waitFor({ state: 'hidden', timeout: 60000 });
  } catch {
    // No editor step for this media (or it already closed) — carry on.
  }
}

async function waitUploadReady(page, scope, mediaPaths) {
  const postButton = scope.getByRole('button', { name: /^post$/i }).first();

  const hasVideo = mediaPaths.some((f) => /\.(mp4|mov|m4v|webm)$/i.test(f));
  const timeoutMs = hasVideo ? 300000 : 60000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const enabled = await postButton
      .isEnabled()
      .catch(() => false)
      .then(async (ok) => {
        if (!ok) return false;
        const busy = await scope
          .locator('text=/uploading|processing|sending/i')
          .count()
          .catch(() => 0);
        return busy === 0;
      });
    if (enabled) return postButton;
    await page.waitForTimeout(1500);
  }

  const shot = await screenshot(page, 'upload-timeout');
  throw new PostError(`Media upload did not complete within ${timeoutMs / 1000}s. Screenshot: ${shot ?? 'n/a'}`, shot);
}

/**
 * Type the post text with human-like keystroke delays, chunked so one slow
 * stretch can't blow the whole budget. Chunk ceilings allow delay + 200ms
 * per char; if a chunk still stalls, the entire text is inserted atomically
 * with fill() — the same race-proof insert the truncation repair uses — and
 * the caller's verification still decides whether it stuck.
 */
async function typePostText(page, editor, text, typeDelay) {
  const chunks = splitChunks(text);
  for (const chunk of chunks) {
    const timeout = Math.max(45000, Math.round(chunk.length * (typeDelay + 200)) + 15000);
    try {
      await editor.pressSequentially(chunk, { delay: typeDelay, timeout });
    } catch {
      console.log('[poster] typing stalled mid-way — text inserted atomically (fill fallback).');
      await page.waitForTimeout(300);
      await editor.fill(text).catch(() => {});
      return;
    }
  }
  console.log(`[poster] typed ${text.length} chars in ${chunks.length} chunk(s).`);
}

/**
 * Split text into ~400-char chunks at newline (then space) boundaries for
 * the per-chunk typing timeouts. Concatenating the chunks reproduces the
 * original text exactly; surrogate pairs (emoji) are never split.
 */
function splitChunks(text, maxLen = 400) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n', maxLen);
    if (cut >= maxLen * 0.4) {
      cut += 1; // keep the newline at the end of this chunk
    } else {
      const sp = rest.lastIndexOf(' ', maxLen);
      if (sp >= maxLen * 0.4) {
        cut = sp + 1;
      } else {
        cut = maxLen;
        const c = rest.charCodeAt(cut - 1);
        if (c >= 0xd800 && c <= 0xdbff) cut -= 1; // don't split a surrogate pair
      }
    }
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function normalizeText(s) {
  return (s ?? '').replace(/[\u00a0\u200b]/g, '').replace(/\s+/g, '');
}

/** True when the editor content matches the source text (tolerating normalization drift). */
function textMatches(actual, expected) {
  const e = normalizeText(expected);
  return e.length === 0 || normalizeText(actual).length >= e.length * 0.95;
}

/**
 * The composer hydrates asynchronously: the audience chips ("Post to
 * Anyone", "Add collaborators") mount after the editor does, and their
 * arrival re-renders the editor — characters typed before the dust settles
 * can be wiped. Wait for the chips (best-effort) before typing.
 */
async function waitComposerSettled(page, scope) {
  const chip = scope.getByRole('button', {
    name: /post to anyone|comments:|add collaborators/i,
  });
  await chip.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function discardDraft(page, scope) {
  const dismiss = scope.locator('button[aria-label="Dismiss"], button[aria-label*="Dismiss" i]').first();
  await dismiss.click().catch(() => {});
  await page.waitForTimeout(1000);
  const confirm = page.getByRole('button', { name: /^discard$/i }).first();
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
  }
}
