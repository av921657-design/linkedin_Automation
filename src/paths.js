import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const DIRS = {
  config: path.join(ROOT, 'config.json'),
  stateDir: path.join(ROOT, 'state'),
  stateFile: path.join(ROOT, 'state', 'state.json'),
  lockFile: path.join(ROOT, 'state', 'run.lock'),
  authFlag: path.join(ROOT, 'state', 'AUTH_REQUIRED'),
  queue: path.join(ROOT, 'queue'),
  posted: path.join(ROOT, 'posted'),
  failed: path.join(ROOT, 'failed'),
  downloads: path.join(ROOT, 'downloads'),
  logs: path.join(ROOT, 'logs'),
  chromeProfile: path.join(ROOT, 'chrome-profile'),
};

export function ensureDirs() {
  for (const d of [DIRS.stateDir, DIRS.queue, DIRS.posted, DIRS.failed, DIRS.downloads, DIRS.logs]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
