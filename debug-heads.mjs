// Diagnostic: inspect the first bytes of each quality variant's segments to
// find where ftyp/moov (init) lives. Uses the URLs saved by debug-concat.
// Usage: node debug-heads.mjs
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './src/paths.js';

const urls = JSON.parse(fs.readFileSync(path.join(DIRS.logs, 'stream-urls.json'), 'utf8'));
const targetId = 'D4E05AQE2r8ttlhdUTw';

const byVariant = new Map(); // variantKey -> {idx -> url}
for (const u of urls) {
  const m = u.match(new RegExp(`playlist/vid/v2/${targetId}/([^/]+)/([^/]+)/(\\d+)/(\\d+)\\?`));
  if (!m) continue;
  const key = m[1];
  if (!byVariant.has(key)) byVariant.set(key, new Map());
  byVariant.get(key).set(Number(m[3]), u);
}

function boxList(buf, max = 12) {
  const out = [];
  let off = 0;
  while (off + 8 <= buf.length && out.length < max) {
    let size = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('latin1');
    if (size === 1) size = Number(buf.readBigUInt64BE(off + 8));
    else if (size === 0) size = buf.length - off;
    if (!/^[\x20-\x7e]{4}$/.test(type) || size < 8 || off + size > buf.length) {
      out.push(`??(${JSON.stringify(type)})@${off}`);
      break;
    }
    out.push(`${type}+${size}`);
    off += size;
  }
  return out.join(' ');
}

for (const [variant, segs] of byVariant) {
  const idxs = [...segs.keys()].sort((a, b) => a - b);
  const idx = idxs[0];
  const u = segs.get(idx);
  try {
    const res = await fetch(u, { headers: { Range: 'bytes=0-1023' } });
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`\n${variant} idx=${idx} status=${res.status} len=${buf.length}`);
    console.log('  ct:', res.headers.get('content-type'), 'cr:', res.headers.get('content-range'));
    console.log('  boxes:', boxList(buf.slice(0, 200)));
    const head = buf.slice(0, 16).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
    console.log('  head16:', JSON.stringify(head));
  } catch (e) {
    console.log(`\n${variant} idx=${idx} -> fetch error: ${e.message}`);
  }
}
