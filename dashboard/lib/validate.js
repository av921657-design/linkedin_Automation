/** Guards the automation against a bad save: the Mac refuses configs that don't pass the same checks. */
export function validateConfig(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['Config must be a JSON object.'] };
  }
  if (!Array.isArray(obj.sources)) {
    errors.push('`sources` must be an array.');
  } else {
    const types = new Set(['folder', 'linkedin', 'x', 'instagram', 'facebook', 'substack', 'medium', 'article']);
    obj.sources.forEach((s, i) => {
      if (!s || typeof s !== 'object') return errors.push(`sources[${i}]: must be an object.`);
      if (!types.has(s.type)) errors.push(`sources[${i}]: unknown type "${s.type}".`);
      if (s.type !== 'folder') {
        const u = s.profileUrl ?? s.url;
        if (!u || !/^https?:\/\//.test(u)) errors.push(`sources[${i}]: needs an http(s) url in profileUrl/url.`);
      }
      if (s.enabled !== undefined && typeof s.enabled !== 'boolean') errors.push(`sources[${i}]: enabled must be true/false.`);
      if (s.maxPostsPerRun !== undefined && !(Number.isInteger(s.maxPostsPerRun) && s.maxPostsPerRun >= 1 && s.maxPostsPerRun <= 50)) {
        errors.push(`sources[${i}]: maxPostsPerRun must be 1–50.`);
      }
      // The runner MOVES each posted folder into posted/, so a path that points
      // outside the project would rename directories it does not own.
      if (s.type === 'folder' && s.path !== undefined) {
        const p = typeof s.path === 'string' ? s.path.trim() : '';
        if (!p) errors.push(`sources[${i}]: path must be a non-empty string.`);
        else if (/^([A-Za-z]:|[\\/])/.test(p) || /(^|[\\/])\.\.([\\/]|$)/.test(p)) {
          errors.push(`sources[${i}]: path must be relative to the project folder and must not climb out of it — posted folders are moved into posted/.`);
        }
      }
      // article.js compiles this inside page.evaluate, and run.js reports a
      // source failure as one log line — an invalid pattern would look like a
      // source that simply never finds anything.
      if (s.linkPattern !== undefined) {
        if (typeof s.linkPattern !== 'string' || !s.linkPattern.trim()) {
          errors.push(`sources[${i}]: linkPattern must be a non-empty regular expression.`);
        } else {
          try { new RegExp(s.linkPattern); }
          catch { errors.push(`sources[${i}]: linkPattern is not a valid regular expression.`); }
        }
      }
    });
  }
  const pool = obj.reformat?.autoHashtags?.pool;
  if (pool !== undefined) {
    if (!Array.isArray(pool)) errors.push('reformat.autoHashtags.pool must be an array.');
    else if (pool.length > 400) errors.push('Hashtag pool is unreasonably large (>400).');
    else if (pool.some((t) => typeof t !== 'string' || !t.trim() || t.length > 30 || /[\s#]/.test(t))) {
      errors.push('Pool tags must be plain words (no spaces/#, ≤30 chars).');
    }
  }
  if (obj.reformat?.maxChars !== undefined && !(Number(obj.reformat.maxChars) >= 500 && Number(obj.reformat.maxChars) <= 3000)) {
    errors.push('reformat.maxChars must be 500–3000 (LinkedIn cap ~3000).');
  }
  const tw = obj.rewrite?.template?.takeawayWords;
  if (tw !== undefined && !(Number.isInteger(tw) && tw >= 10 && tw <= 60)) errors.push('rewrite.template.takeawayWords must be an integer 10–60.');
  const bl = obj.rewrite?.template?.bullets;
  if (bl !== undefined && !(Number.isInteger(bl) && bl >= 1 && bl <= 10)) errors.push('rewrite.template.bullets must be an integer 1–10.');
  const hc = obj.rewrite?.template?.hashtagCount;
  if (hc !== undefined && !(Number.isInteger(hc) && hc >= 1 && hc <= 15)) errors.push('rewrite.template.hashtagCount must be an integer 1–15.');
  const rw = obj.rewrite;
  if (rw !== undefined && rw !== null) {
    if (typeof rw !== 'object' || Array.isArray(rw)) {
      errors.push('rewrite must be an object.');
    } else {
      if (rw.enabled !== undefined && typeof rw.enabled !== 'boolean') errors.push('rewrite.enabled must be true/false.');
      if (rw.mode !== undefined && !['auto', 'llm', 'extractive'].includes(rw.mode)) {
        errors.push('rewrite.mode must be "auto", "llm" or "extractive".');
      }
      if (rw.attribution !== undefined && typeof rw.attribution !== 'boolean') errors.push('rewrite.attribution must be true/false.');
      if (rw.targetChars !== undefined && !(Number.isInteger(rw.targetChars) && rw.targetChars >= 200 && rw.targetChars <= 2900)) {
        errors.push('rewrite.targetChars must be an integer 200–2900.');
      }
      if (rw.maxSentences !== undefined && !(Number.isInteger(rw.maxSentences) && rw.maxSentences >= 1 && rw.maxSentences <= 20)) {
        errors.push('rewrite.maxSentences must be an integer 1–20.');
      }
    }
  }
  const llm = obj.rewrite?.llm;
  if (llm !== undefined) {
    if (!llm || typeof llm !== 'object' || Array.isArray(llm)) {
      errors.push('rewrite.llm must be an object.');
    } else {
      if (llm.apiKey !== undefined || llm.token !== undefined) {
        errors.push('Never store an API key in the dashboard — keys live on the Mac (npm run llm:setup → state/rewrite.key).');
      }
      if (llm.baseUrl !== undefined && !/^https?:\/\/\S+$/i.test(String(llm.baseUrl))) {
        errors.push('rewrite.llm.baseUrl must be a full http(s) url, e.g. https://generativelanguage.googleapis.com/v1beta/openai');
      }
      if (llm.model !== undefined && (typeof llm.model !== 'string' || !llm.model.trim() || llm.model.length > 80)) {
        errors.push('rewrite.llm.model must be a non-empty string ≤80 characters.');
      }
      // Models tried, in order, when the main one is throttled (429) or rejects —
      // free pools are shared, so rotation is normal.
      if (llm.fallbackModels !== undefined) {
        if (!Array.isArray(llm.fallbackModels)) errors.push('rewrite.llm.fallbackModels must be an array of model ids.');
        else if (llm.fallbackModels.length > 5) errors.push('rewrite.llm.fallbackModels is limited to 5 models.');
        else if (llm.fallbackModels.some((m) => typeof m !== 'string' || !m.trim() || m.length > 80)) {
          errors.push('rewrite.llm.fallbackModels entries must be non-empty strings ≤80 characters.');
        }
      }
      if (llm.noAuth !== undefined && typeof llm.noAuth !== 'boolean') errors.push('rewrite.llm.noAuth must be true/false.');
      if (llm.timeoutMs !== undefined && !(Number(llm.timeoutMs) >= 5000 && Number(llm.timeoutMs) <= 180000)) {
        errors.push('rewrite.llm.timeoutMs must be 5000–180000 ms.');
      }
      if (llm.retryDelayMs !== undefined && !(Number(llm.retryDelayMs) >= 0 && Number(llm.retryDelayMs) <= 120000)) {
        errors.push('rewrite.llm.retryDelayMs must be 0–120000 ms.');
      }
      if (llm.apiKeyEnv !== undefined && (typeof llm.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(llm.apiKeyEnv))) {
        errors.push('rewrite.llm.apiKeyEnv must be an env-var NAME (e.g. REWRITE_API_KEY), never the key itself.');
      }
      // apiKeyFile is a path on the Mac (or false to disable the AI and force extractive).
      if (llm.apiKeyFile !== undefined && llm.apiKeyFile !== false && (typeof llm.apiKeyFile !== 'string' || !llm.apiKeyFile.trim() || llm.apiKeyFile.length > 200)) {
        errors.push('rewrite.llm.apiKeyFile must be a file path string (or false).');
      }
    }
  }
  if (obj.post?.maxPerRun !== undefined && !(Number.isInteger(obj.post.maxPerRun) && obj.post.maxPerRun >= 1 && obj.post.maxPerRun <= 5)) {
    errors.push('post.maxPerRun must be 1–5 (keep posting human-paced).');
  }
  // Playwright rejects a negative typing delay, which would fail EVERY post.
  for (const k of ['minTypeDelayMs', 'maxTypeDelayMs']) {
    if (obj.post?.[k] !== undefined && !(Number.isInteger(obj.post[k]) && obj.post[k] >= 0 && obj.post[k] <= 5000)) {
      errors.push(`post.${k} must be an integer 0–5000 ms.`);
    }
  }
  if (obj.post?.minTypeDelayMs !== undefined && obj.post?.maxTypeDelayMs !== undefined
    && Number(obj.post.minTypeDelayMs) > Number(obj.post.maxTypeDelayMs)) {
    errors.push('post.minTypeDelayMs must not exceed maxTypeDelayMs.');
  }
  const br = obj.browser;
  if (br !== undefined) {
    if (!br || typeof br !== 'object' || Array.isArray(br)) {
      errors.push('browser must be an object.');
    } else {
      if (br.profileDir !== undefined && (typeof br.profileDir !== 'string' || !br.profileDir.trim() || br.profileDir.length > 200)) {
        errors.push('browser.profileDir must be a non-empty path string.');
      }
      if (br.channel !== undefined && (typeof br.channel !== 'string' || !br.channel.trim() || br.channel.length > 40)) {
        errors.push('browser.channel must be a channel name like "chrome".');
      }
      if (br.headless !== undefined && typeof br.headless !== 'boolean') errors.push('browser.headless must be true/false.');
      if (br.locale !== undefined && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(String(br.locale))) {
        errors.push('browser.locale must look like "en-US".');
      }
    }
  }
  const sch = obj.schedule;
  if (sch !== undefined) {
    if (!sch || typeof sch !== 'object' || Array.isArray(sch)) {
      errors.push('schedule must be an object.');
    } else {
      if (sch.timezone !== undefined) {
        const badShape = typeof sch.timezone !== 'string' || !/^[A-Za-z0-9_+/.-]{1,64}$/.test(sch.timezone);
        let badZone = false;
        if (!badShape) {
          try { new Intl.DateTimeFormat('en-US', { timeZone: sch.timezone }); }
          catch { badZone = true; }
        }
        if (badShape || badZone) errors.push('schedule.timezone must be a real IANA zone like "Asia/Kolkata" or "America/New_York".');
      }
      // weekday / weekend / legacy hours: whole-hour 0–23 lists. An EMPTY list is
      // valid and means "no runs on those days" (not a silent fallback).
      for (const k of ['weekday', 'weekend', 'hours']) {
        if (sch[k] === undefined) continue;
        if (!Array.isArray(sch[k])) errors.push(`schedule.${k} must be an array of hours 0–23.`);
        else if (sch[k].length > 24) errors.push(`schedule.${k} can hold at most 24 hours.`);
        else if (sch[k].some((h) => !(Number.isInteger(h) && h >= 0 && h <= 23))) {
          errors.push(`schedule.${k} entries must be whole hours 0–23.`);
        }
      }
    }
  }
  const eng = obj.engagement;
  if (eng !== undefined) {
    if (!eng || typeof eng !== 'object' || Array.isArray(eng)) {
      errors.push('engagement must be an object.');
    } else {
      if (eng.enabled !== undefined && typeof eng.enabled !== 'boolean') errors.push('engagement.enabled must be true/false.');
      if (eng.like !== undefined && typeof eng.like !== 'boolean') errors.push('engagement.like must be true/false.');
      if (!['none', 'fixed', 'pool', 'ai'].includes(eng.commentMode ?? 'none')) {
        errors.push('engagement.commentMode must be "none", "fixed", "pool" or "ai".');
      }
      if (eng.commentMode === 'fixed' && !(typeof eng.text === 'string' && eng.text.trim())) {
        errors.push('engagement.commentMode is "fixed" but engagement.text is empty.');
      }
      if (eng.text !== undefined && typeof eng.text !== 'string') errors.push('engagement.text must be a string.');
      if (eng.text !== undefined && String(eng.text).length > 700) errors.push('engagement.text must be ≤700 characters.');
      if (eng.pool !== undefined) {
        if (!Array.isArray(eng.pool)) errors.push('engagement.pool must be an array of comment texts.');
        else {
          if (eng.pool.length > 100) errors.push('engagement.pool is unreasonably large (>100).');
          if (eng.pool.some((t) => typeof t !== 'string' || !t.trim() || t.length > 700)) {
            errors.push('Pool comments must be non-empty strings ≤700 characters.');
          }
        }
      }
      if ((eng.commentMode === 'pool') && !(Array.isArray(eng.pool) && eng.pool.some((t) => typeof t === 'string' && t.trim()))) {
        errors.push('engagement.commentMode is "pool" but the pool has no usable comment.');
      }
      // Targets: handles and/or keywords. Each is an optional array of strings.
      for (const k of ['handles', 'keywords']) {
        if (eng[k] !== undefined) {
          if (!Array.isArray(eng[k])) errors.push(`engagement.${k} must be an array of strings.`);
          else {
            if (eng[k].length > 50) errors.push(`engagement.${k} is unreasonably large (>50).`);
            if (eng[k].some((t) => typeof t !== 'string' || !t.trim())) errors.push(`engagement.${k} entries must be non-empty strings.`);
          }
        }
      }
      // Enabled with no target is inert, not invalid: the runner logs
      // "nothing to engage" and moves on. Never block unrelated saves on it —
      // the Limits tab shows a "needs targets" pill instead.
      if (eng.pickStrategy !== undefined && !['top', 'recent', 'topRecent'].includes(eng.pickStrategy)) {
        errors.push('engagement.pickStrategy must be "top", "recent" or "topRecent".');
      }
      if (eng.maxPerRun !== undefined && !(Number.isInteger(eng.maxPerRun) && eng.maxPerRun >= 1 && eng.maxPerRun <= 3)) {
        errors.push('engagement.maxPerRun must be 1–3 (keep engagement human-paced).');
      }
      if (eng.feedScrolls !== undefined && !(Number.isInteger(eng.feedScrolls) && eng.feedScrolls >= 1 && eng.feedScrolls <= 20)) {
        errors.push('engagement.feedScrolls must be 1–20.');
      }
      for (const k of ['minDelayMs', 'maxDelayMs']) {
        if (eng[k] !== undefined && !(Number(eng[k]) >= 1000 && Number(eng[k]) <= 600000)) {
          errors.push(`engagement.${k} must be 1000–600000 ms.`);
        }
      }
      if (Number(eng.minDelayMs) > Number(eng.maxDelayMs)) errors.push('engagement.minDelayMs must not exceed maxDelayMs.');
    }
  }
  return { ok: errors.length === 0, errors };
}
