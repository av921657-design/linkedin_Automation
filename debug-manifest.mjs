// Diagnostic: find the HLS manifest/metadata for feed videos and probe the
// segment URL template (init segment, index range) to plan the downloader.
// Usage: node debug-manifest.mjs
import fs from 'node:fs';
import { launch, guardAuth } from './src/browser.js';
import { ensureDirs, DIRS } from './src/paths.js';

const cfg = JSON.parse(fs.readFileSync(DIRS.config, 'utf8'));
const url = cfg.sources.find((s) => s.type === 'linkedin')?.profileUrl;

const segmentRe = /dms\.licdn\.com\/playlist\/vid\/.+\/hls-/;
const segments = [];
const jsonHits = [];
const jsonSeen = { count: 0, hosts: {} };

ensureDirs();
const context = await launch(cfg);
const page = context.pages()[0] ?? (await context.newPage());

context.on('response', async (r) => {
  try {
    const u = r.url();
    if (segmentRe.test(u) && !segments.includes(u)) segments.push(u);

    const ct = r.headers()['content-type'] || '';
    if (ct.includes('json') && /\/voyager\/api\//.test(u)) {
      jsonSeen.count++;
      const host = new URL(u).host;
      jsonSeen.hosts[host] = (jsonSeen.hosts[host] || 0) + 1;
      const cl = Number(r.headers()['content-length'] || 0);
      if (jsonSeen.count <= 200 && cl < 12_000_000) {
        const text = await r.text().catch(() => '');
        if (text && /playlist\/vid|m3u8/.test(text)) {
          const idx = text.search(/playlist\/vid|m3u8/);
          jsonHits.push({ url: u.slice(0, 180), snippet: text.slice(Math.max(0, idx - 300), idx + 700) });
        }
      }
    }
  } catch {}
});

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await guardAuth(page);
  await page.waitForTimeout(6000);
  for (let i = 0; i < 2; i++) {
    await page.mouse.wheel(0, 1600).catch(() => {});
    await page.waitForTimeout(1500);
  }

  console.log('segments captured:', segments.length);
  console.log('voyager json responses seen:', jsonSeen.count, JSON.stringify(jsonSeen.hosts));
  console.log('\nJSON bodies mentioning playlist/vid or m3u8:', jsonHits.length);
  for (const h of jsonHits.slice(0, 5)) {
    console.log('---', h.url);
    console.log(h.snippet.replace(/\\u002F/g, '/').slice(0, 900));
  }

  if (segments.length) {
    // Derive the template from the first segment URL.
    const sample = segments.find((u) => /\/1\/\d+/.test(u)) || segments[0];
    const m = sample.match(/^(.*\/)(\d+)\/(\d+)(\?.*)$/);
    console.log('\nsample:', sample.slice(0, 160));
    if (m) {
      const [, baseDir, segIdx, ts, qs] = m;
      console.log(`template: ${baseDir}{INDEX}/${ts}${qs.slice(0, 40)}...`);
      for (const idx of ['0', '3', String(Number(segIdx) + 7), '9999']) {
        const probe = `${baseDir}${idx}/${ts}${qs}`;
        try {
          const res = await context.request.get(probe, {
            timeout: 20000,
            headers: { Range: 'bytes=0-400' },
          });
          const buf = await res.body();
          const magic = buf.slice(0, 16).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
          console.log(
            `probe /${idx}/ -> ${res.status()} ct=${res.headers()['content-type']} len=${buf.length} head="${magic}"`,
          );
        } catch (e) {
          console.log(`probe /${idx}/ -> ERROR ${e.message}`);
        }
      }
    } else {
      console.log('could not parse template from sample');
    }
  }
} finally {
  await context.close();
}
