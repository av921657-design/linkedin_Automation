import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../paths.js';

/**
 * Article source: turns any blog's articles into repost candidates.
 *
 *   {
 *     "type": "article",
 *     "url": "https://any-blog.example/blog",    // listing page or RSS feed
 *     "maxPostsPerRun": 5,
 *     "enabled": true,
 *     "linkPattern": "^/blog/.+"                  // optional, restricts links
 *   }
 *
 * Works with any blog, no per-site code:
 *   1) If the listing advertises an RSS/Atom feed (<link rel="alternate">),
 *      the feed is parsed for article links — feeds are uniform where DOMs
 *      differ. A URL pointing straight at a feed works too.
 *   2) Otherwise the listing page's own links are used: everything under the
 *      listing path (e.g. /blog/<slug>), plus date-style URLs (/2024/05/slug),
 *      minus a denylist of known non-article pages (about, privacy, tags…).
 *   3) linkPattern (regex on the pathname) overrides both rules entirely.
 *
 * Each article is then opened, title + main text extracted (nav/footer/share
 * chrome stripped) plus og:image, and cached under downloads/<hash>/ so every
 * article is fetched once. The ledger prevents reposts; reformat() adds
 * hashtags and caps the length, so long articles become punchy summaries.
 * Multiple article entries can be configured to mix several blogs.
 */

const CHROME_SELECTOR =
  'nav, header, footer, aside, script, style, noscript, form, button, ' +
  '[class*="newsletter"], [class*="subscribe"], [class*="sidebar"], ' +
  '[class*="share"], [class*="related"], [class*="comment"], [class*="footer"]';

/** Common non-article pages filtered out of root-level blog listings. */
const PAGE_DENYLIST =
  /\/(about|contact|privacy(-?policy)?|terms|press|jobs|careers|advertise|advertising|login|signin|signup|register|wp-(admin|login|content|includes)|feed|rdf|rss2?|atom|search|shop|store|cart|checkout|donate|newsletter|subscribe|podcast|disclaimer|accessibility|sitemap|page)(\/|$)/i;

/** Detect a same-site RSS/Atom feed advertised in the listing page's head. */
async function findFeedUrl(page) {
  return page.evaluate(() => {
    const link = document.querySelector(
      'link[type*="rss+xml"], link[type*="atom+xml"]',
    );
    return link?.href ?? null;
  });
}

/** Extract article links from an RSS/Atom feed (handles CDATA and atom hrefs). */
async function feedLinks(context, feedUrl) {
  const res = await context.request.get(feedUrl, { timeout: 30000 });
  if (!res.ok()) return [];
  const xml = await res.text();
  const items = xml.match(/<(item|entry)[\s\S]*?<\/\1>/gi) ?? [];
  const out = [];
  const seen = new Set();
  for (const item of items) {
    let href =
      item.match(/<link[^>]*\bhref=["']([^"']+)["']/i)?.[1] ??
      item.match(/<link>(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?<\/link>/i)?.[1]?.trim() ??
      item.match(/<guid[^>]*isPermaLink=["']?true["']?[^>]*>([^<]+)<\/guid>/i)?.[1]?.trim() ??
      null;
    if (!href) continue;
    try {
      href = new URL(href, feedUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:/i.test(href)) continue;
    const key = href.replace(/[#?].*$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(href);
  }
  return out;
}

export async function collectCandidates(source, page, context, log) {
  const listUrl = source.url;
  if (!listUrl || /YOUR-URL|ANY-BLOG\.example/i.test(listUrl)) {
    log('[article] url not configured — skipping source.');
    return [];
  }
  const maxPosts = source.maxPostsPerRun ?? 5;
  const listPath = new URL(listUrl).pathname.replace(/\/+$/, '') || '/';

  // Preferred: the blog's own RSS/Atom feed (uniform structure, newest-first).
  // Fallback: scrape the listing page's links with generic heuristics.
  let links = [];
  const feedHint = /\/(feed|rss|rdf|atom)(\.xml|\/)?$|format=feed/i.test(listUrl);
  if (feedHint) {
    // Never page.goto an XML URL — browsers may turn it into a download.
    links = await feedLinks(context, listUrl).catch(() => []);
    if (links.length) log(`[article] Using feed ${listUrl} — ${links.length} link(s).`);
  }

  if (!links.length) {
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);

    const feedUrl = await findFeedUrl(page).catch(() => null);
    if (feedUrl) {
      links = await feedLinks(context, feedUrl).catch(() => []);
      if (links.length) {
        log(`[article] Using feed ${feedUrl} — ${links.length} link(s).`);
      }
    }
  }

  if (!links.length) {
    const scraped = await page.evaluate(
      ({ listPath, linkPattern, deny }) => {
        const ok = (url) => {
          if (!url || url.origin !== location.origin) return false;
          const p = url.pathname;
          if (p === listPath || p === `${listPath}/`) return false; // the listing itself
          if (/\.(png|jpe?g|gif|svg|pdf|css|js|ico|xml|webp|mp4)$/i.test(p)) return false;
          if (new RegExp(deny).test(p)) return false; // non-article pages, pagination, feeds
          if (linkPattern && !new RegExp(linkPattern).test(p)) return false;
          return true;
        };
        const collect = (anchors) => {
          const out = [];
          const seen = new Set();
          for (const a of anchors) {
            let url;
            try {
              url = new URL(a.href, location.origin);
            } catch {
              continue;
            }
            if (!ok(url)) continue;
            const key = url.origin + url.pathname;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(url.href);
          }
          return out;
        };
        // Classic blog-index markup first: titles are anchors inside headings.
        // Only fall back to every-link heuristics when no heading links exist.
        const heading = collect(
          document.querySelectorAll('h1 a[href], h2 a[href], h3 a[href], h4 a[href]'),
        );
        if (heading.length) return { heading, links: [] };
        const links = collect(document.querySelectorAll('a[href]')).filter((href) => {
          if (linkPattern) return true;
          const p = new URL(href).pathname;
          const underListing = p.startsWith(listPath === '/' ? '/' : `${listPath}/`);
          const datePath = /^\/(19|20)\d{2}(\/|$)/.test(p); // /2024/05/post-slug
          return underListing || datePath;
        });
        return { heading: [], links };
      },
      { listPath, linkPattern: source.linkPattern ?? null, deny: PAGE_DENYLIST.source },
    );
    links = scraped.heading.length ? scraped.heading : scraped.links;
  }

  if (!links.length) {
    log(`[article] No article links found at ${listUrl} — check url/linkPattern.`);
    return [];
  }

  const candidates = [];
  for (const href of links.slice(0, maxPosts)) {
    const hash = crypto.createHash('sha256').update(href).digest('hex').slice(0, 32);
    const dir = path.join(DIRS.downloads, hash);
    const cacheFile = path.join(dir, 'article.json');

    let data;
    if (fs.existsSync(cacheFile)) {
      try {
        data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      } catch {
        data = null;
      }
    }
    if (!data) {
      data = await scrapeArticle(page, href).catch((e) => {
        log(`[article] ${href} failed: ${e.message}`);
        return null;
      });
      if (!data || !data.body) continue;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ ...data, href }, null, 2));
      if (data.image) await download(context, data.image, path.join(dir, 'cover.jpg'));
    }

    const cover = path.join(dir, 'cover.jpg');
    const media = fs.existsSync(cover) ? [cover] : [];
    candidates.push({
      id: `article:${hash}`,
      hash,
      text: data.title ? `${data.title}\n\n${data.body}` : data.body,
      media,
      order: candidates.length,
      source: 'article',
      moveTo: () => null, // ledger alone prevents reposts
    });
  }

  log(`[article] ${candidates.length} article(s) ready from ${listUrl}`);
  return candidates;
}

export async function scrapeArticle(page, href) {
  await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1500);
  return page.evaluate((CHROME) => {
    const root =
      document.querySelector('article') ??
      document.querySelector('main') ??
      document.body;
    const title = (
      document.querySelector('meta[property="og:title"]')?.content ??
      document.querySelector('h1')?.innerText ??
      ''
    ).trim();

    const copy = root.cloneNode(true);
    copy.querySelectorAll(CHROME).forEach((n) => n.remove());
    const seen = new Set();
    const body = [];
    for (const el of copy.querySelectorAll('h1, h2, h3, h4, p, li')) {
      const t = (el.innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!t || t.length < 3) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      body.push(t);
    }
    return {
      title,
      body: body.join('\n\n'),
      image: document.querySelector('meta[property="og:image"]')?.content ?? null,
    };
  }, CHROME_SELECTOR);
}

async function download(context, url, dest) {
  try {
    const res = await context.request.get(url, { timeout: 30000 });
    if (!res.ok()) return false;
    const buf = await res.body();
    if (!buf || buf.length < 1024) return false;
    fs.writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}
