import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../paths.js';
import { scrapeArticle } from './article.js';

/**
 * RSS/Atom content source for Substack and Medium (and any feed with full
 * article content). One module, two configured types — run.js normalizes the
 * platform URL to the feed and calls collectCandidates:
 *
 *   { "type": "substack", "url": "https://<pub>.substack.com or custom domain" }
 *     -> feed at <origin>/feed
 *   { "type": "medium",   "url": "https://medium.com/@handle or /<publication>" }
 *     -> feed at https://medium.com/feed/<path>
 *
 * Both platforms publish full article HTML in content:encoded, so candidates
 * are built straight from the feed — no per-article page visits. Candidates
 * carry `summarize: true` + `articleUrl` so run.js can rewrite them into
 * short posts (see src/summarize.js) before reformat() adds hashtags.
 * The ledger prevents reposts; attribution to the source is appended by the
 * rewrite step (config.rewrite.attribution, on by default).
 */

/** Normalize any Substack/Medium URL to its RSS feed. */
export function normalizeFeedUrl(type, raw) {
  const url = String(raw ?? '').trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    if (/\/feed(\/|$)|\/rss(\/|$)|\/atom/i.test(u.pathname)) return u.href; // already a feed
    if (type === 'substack') {
      return `${u.origin}/feed`;
    }
    if (type === 'medium') {
      if (!/medium\.com$/i.test(u.hostname)) return `${u.origin}/feed`; // custom-domain publication
      return `https://medium.com/feed${u.pathname.replace(/\/+$/, '')}`;
    }
    return null;
  } catch {
    return null;
  }
}

/** Minimal RSS/Atom item parser: title, link, author, date, content HTML. */
export function parseFeedItems(xml, feedUrl) {
  const items = xml.match(/<(item|entry)[\s\S]*?<\/\1>/gi) ?? [];
  const out = [];
  for (const item of items) {
    const pick = (tag) => {
      const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
      if (!m) return '';
      return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    };
    let link =
      item.match(/<link[^>]*\bhref=["']([^"']+)["']/i)?.[1] ||
      pick('link') ||
      item.match(/<guid[^>]*isPermaLink=["']?true["']?[^>]*>([^<]+)<\/guid>/i)?.[1] ||
      '';
    // `pick` returns '' rather than null, so this needs || not ??. An item with
    // no permalink must be dropped: resolving '' against the feed URL would
    // give every such item the feed's own address, and the dedupe below would
    // then collapse them all into one bogus candidate.
    if (!link) continue;
    try {
      link = new URL(link.trim(), feedUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:/i.test(link)) continue;
    const contentHtml = pick('content:encoded') || pick('content') || pick('description');
    out.push({
      link,
      title: decodeEntities(pick('title')).replace(/\s+/g, ' ').trim(),
      author: decodeEntities(pick('dc:creator') || pick('author')).replace(/\s+/g, ' ').trim(),
      date: pick('pubDate') || pick('published') || pick('updated'),
      contentHtml,
    });
  }
  return out;
}

/** HTML -> plain text, preserving paragraph breaks; also returns first image. */
export function htmlToText(html) {
  const img =
    html.match(/<img[^>]*\bsrc=["']([^"']+)["']/i)?.[1] ?? null;
  const text = decodeEntities(
    String(html ?? '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h[1-6]|li|blockquote|div)>/gi, '\n\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, image: img };
}

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export async function collectCandidates(source, context, log) {
  const type = source.type === 'medium' ? 'medium' : 'substack';
  // Checked before normalization: URL parsing lowercases the host, so the
  // shipped placeholders would no longer be recognizable afterwards.
  if (/YOUR-PUB\.substack\.com|@your-handle/i.test(String(source.url ?? ''))) {
    log(`[${type}] url not configured — skipping source.`);
    return [];
  }
  const feedUrl = normalizeFeedUrl(type, source.url);
  if (!feedUrl) {
    log(`[${type}] url not configured or invalid — skipping source.`);
    return [];
  }
  const maxPosts = source.maxPostsPerRun ?? 10;

  const res = await context.request.get(feedUrl, { timeout: 45000 }).catch((e) => {
    throw new Error(`feed fetch failed (${e.message})`);
  });
  if (!res.ok()) {
    throw new Error(`feed ${feedUrl} returned ${res.status()}`);
  }
  const items = parseFeedItems(await res.text(), feedUrl);
  if (!items.length) {
    log(`[${type}] Feed ${feedUrl} has no entries.`);
    return [];
  }

  // Newest first.
  items.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));

  const candidates = [];
  const seen = new Set();
  for (const item of items) {
    if (candidates.length >= maxPosts) break;
    // Clean tracking params (Medium appends ?source=rss----…).
    let link;
    try {
      link = new URL(item.link);
      link.search = '';
      link = link.href;
    } catch {
      link = item.link;
    }
    const key = link.replace(/[#?].*$/, '');
    if (seen.has(key)) continue;
    seen.add(key);

    let body = '';
    let image = null;
    if (item.contentHtml) {
      ({ text: body, image } = htmlToText(item.contentHtml));
    }
    // Medium (and some other feeds) ship only a snippet in <description> —
    // fall back to visiting the article page for the real text.
    if (body.length < 200) {
      const page = context.pages()[0] ?? (await context.newPage());
      try {
        const scraped = await scrapeArticle(page, link);
        body = scraped.title && !item.title ? scraped.title : scraped.body;
        image = image ?? scraped.image;
      } catch (e) {
        log(`[${type}] ${link} page fetch failed: ${e.message}`);
        continue;
      }
    }
    if (body.length < 200) continue; // paywalled / JS-walled — nothing usable

    const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
    const dir = path.join(DIRS.downloads, hash);
    const media = [];
    if (image && !fs.existsSync(path.join(dir, '.scraped'))) {
      fs.mkdirSync(dir, { recursive: true });
      await download(context, image, path.join(dir, 'cover.jpg'));
      fs.writeFileSync(path.join(dir, '.scraped'), 'done');
    }
    const cover = path.join(dir, 'cover.jpg');
    if (fs.existsSync(cover)) media.push(cover);

    candidates.push({
      id: `${type}:${hash}`,
      hash,
      text: item.title ? `${item.title}\n\n${body}` : body,
      media,
      order: Date.parse(item.date) || candidates.length,
      source: type,
      // Rewrite metadata for the summarizer stage in run.js.
      summarize: true,
      articleUrl: link,
      articleAuthor: item.author,
      moveTo: () => null,
    });
  }

  log(`[${type}] ${candidates.length} article(s) ready from ${feedUrl}`);
  return candidates;
}

async function download(context, url, dest) {
  try {
    const res = await context.request.get(url, { timeout: 45000 });
    if (!res.ok()) return false;
    const buf = await res.body();
    if (!buf || buf.length < 1024) return false;
    fs.writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}
