import fs from 'node:fs';
import { DIRS } from './paths.js';

/**
 * Ledger: persisted record of what has been posted and how many times a
 * candidate failed, so runs are idempotent and nothing double-posts.
 */
export class Ledger {
  constructor(file = DIRS.stateFile) {
    this.file = file;
    this.data = this.#load();
  }

  #load() {
    let data = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed && typeof parsed === 'object') data = parsed;
    } catch {
      // missing or corrupt — start empty
    }
    for (const section of ['posted', 'attempts', 'engaged']) {
      if (typeof data[section] !== 'object' || data[section] === null) data[section] = {};
    }
    return data;
  }

  save() {
    fs.mkdirSync(DIRS.stateDir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n');
  }

  isPosted(hash) {
    return Boolean(this.data.posted[hash]);
  }

  markPosted(hash, meta = {}) {
    this.data.posted[hash] = { at: new Date().toISOString(), ...meta };
    // Attempts are keyed by candidate id, which callers pass as meta.ref.
    if (meta.ref) delete this.data.attempts[meta.ref];
    this.save();
  }

  attempts(id) {
    return this.data.attempts[id]?.count ?? 0;
  }

  lastError(id) {
    return this.data.attempts[id]?.lastError ?? null;
  }

  bumpAttempt(id, error = null) {
    const entry = this.data.attempts[id] ?? { count: 0, lastAt: null, lastError: null };
    entry.count += 1;
    entry.lastAt = new Date().toISOString();
    entry.lastError = error ? String(error).slice(0, 500) : null;
    this.data.attempts[id] = entry;
    this.save();
    return entry.count;
  }

  postedCount() {
    return Object.keys(this.data.posted).length;
  }

  /** Outbound engagement dedupe: a post (by URN) is liked/commented only once, ever. */
  isEngaged(urn) {
    return Boolean(urn && this.data.engaged?.[urn]);
  }

  markEngaged(urn, meta = {}) {
    if (!urn) return;
    this.data.engaged = this.data.engaged ?? {};
    this.data.engaged[urn] = { at: new Date().toISOString(), ...meta };
    this.save();
  }

  engagedCount() {
    return Object.keys(this.data.engaged ?? {}).length;
  }
}
