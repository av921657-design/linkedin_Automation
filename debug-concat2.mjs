// Diagnostic: rebuild video-sample.mp4 cleanly from ONE quality variant
// (init at /1/, media at /2/../N/) using the URLs saved by debug-concat.
// Usage: node debug-concat2.mjs
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './src/paths.js';

const urls = JSON.parse(fs.readFileSync(path.join(DIRS.logs, 'stream-urls.json'), 'utf8'));
const targetId = 'D4E05AQE2r8ttlhdUTw';

const variants = new Map();
for (const u of urls) {
  const m = u.match(new RegExp(`playlist/vid/v2/${targetId}/([^/]+)/([^/]+)/(\\d+)/(\\d+)\\?`));
  if (!m || m[1].includes('singleton')) continue;
  if (!variants.has(m[1])) variants.set(m[1], new Map());
  variants.get(m[1]).set(Number(m[3]), u);
}

let best = null;
let bestN = 0;
for (const [k, m] of variants) {
  if (m.size > bestN) {
    best = k;
    bestN = m.size;
  }
}
console.log(
  'variants:',
  [...variants.entries()].map(([k, m]) => `${k}:${m.size}`).join(', '),
);
console.log('chosen:', best, `(${bestN} segments)`);

const segs = variants.get(best);
const idxs = [...segs.keys()].sort((a, b) => a - b);
const max = idxs[idxs.length - 1];
const missing = [];
for (let i = 1; i <= max; i++) if (!segs.has(i)) missing.push(i);
console.log(`indices ${idxs[0]}..${max}, missing: ${missing.length}`, missing.slice(0, 10));

const chunks = [];
for (let i = 1; i <= max; i++) {
  const res = await fetch(segs.get(i));
  if (!res.ok) {
    console.log('fetch failed at index', i, 'status', res.status);
    process.exit(1);
  }
  chunks.push(Buffer.from(await res.arrayBuffer()));
  if (i % 10 === 0) console.log('fetched', i, '/', max);
}
const out = Buffer.concat(chunks);
const dest = path.join(DIRS.logs, 'video-sample.mp4');
fs.writeFileSync(dest, out);
console.log('wrote', dest, out.length, 'bytes');

// Top-level box scan.
const scan = [];
let off = 0;
while (off + 8 <= out.length && scan.length < 30) {
  let size = out.readUInt32BE(off);
  const type = out.slice(off + 4, off + 8).toString('latin1');
  if (size === 1) size = Number(out.readBigUInt64BE(off + 8));
  else if (size === 0) size = out.length - off;
  if (!/^[\x20-\x7e]{4}$/.test(type) || size < 8 || off + size > out.length) {
    scan.push(`??(${JSON.stringify(type)})@${off}`);
    break;
  }
  scan.push(`${type}+${size}`);
  off += size;
}
console.log('\nfirst boxes:', scan.join(' '));

const handlers = [];
let i = 0;
while ((i = out.indexOf('hdlr', i)) !== -1 && handlers.length < 8) {
  handlers.push(out.slice(i + 12, i + 16).toString('latin1').replace(/[^\x20-\x7e]/g, '.'));
  i += 4;
}
console.log('hdlr types:', handlers.join(', '));
