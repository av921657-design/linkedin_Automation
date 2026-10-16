import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DIRS, ROOT } from '../paths.js';

const TEXT_FILE = /^post\.(txt|md)$/i;
const IGNORED = /^(\.|_)/; // dotfiles and files starting with underscore

/**
 * Folder source: each subfolder of queue/ is one candidate post.
 *   queue/my-post/post.txt      <- required (or post.md)
 *   queue/my-post/cover.jpg     <- optional media (images/videos)
 *   queue/my-post/clip.mp4
 * Returns candidates with a content hash so edited posts count as new.
 */
export async function collectCandidates(source, cfg) {
  const root = source.path
    ? path.isAbsolute(source.path)
      ? source.path
      : path.join(ROOT, source.path)
    : DIRS.queue;
  if (!fs.existsSync(root)) return [];

  const candidates = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || IGNORED.test(entry.name)) continue;
    const dir = path.join(root, entry.name);

    let textPath = null;
    const media = [];
    let sawAnyFile = false;

    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      sawAnyFile = true;
      const full = path.join(dir, f.name);
      if (TEXT_FILE.test(f.name)) {
        textPath = full;
      } else if (!IGNORED.test(f.name)) {
        media.push(full);
      }
    }

    if (!sawAnyFile) continue;
    if (!textPath) {
      console.warn(`[folder] Skipping "${entry.name}": no post.txt / post.md found.`);
      continue;
    }

    const text = fs.readFileSync(textPath, 'utf8');
    const stat = fs.statSync(textPath);
    const mediaSig = media
      .map((m) => `${path.basename(m)}:${fs.statSync(m).size}`)
      .sort()
      .join('|');
    const hash = crypto
      .createHash('sha256')
      .update(text)
      .update('\u0000')
      .update(mediaSig)
      .digest('hex')
      .slice(0, 32);

    candidates.push({
      id: `folder:${entry.name}`,
      hash,
      text,
      media,
      order: stat.mtimeMs,
      source: 'folder',
      // movement used after posting / giving up
      dir,
      moveTo: (bucket) => moveTo(dir, bucket, entry.name),
    });
  }

  candidates.sort((a, b) => a.order - b.order);
  return candidates;
}

function moveTo(dir, bucket, name) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(bucket, `${name}-${stamp}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(dir, target);
  return target;
}
