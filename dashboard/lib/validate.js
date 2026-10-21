/** The three-letter weekday names a newsletter event may name. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
  // The day's hard ceiling, counted from published posts only. 1–10 mirrors the
  // clamp in src/quota.js, so the dashboard can never offer a value the runners
  // silently rewrite.
  if (obj.post?.maxPerDay !== undefined && !(Number.isInteger(obj.post.maxPerDay) && obj.post.maxPerDay >= 1 && obj.post.maxPerDay <= 10)) {
    errors.push('post.maxPerDay must be 1–10 (published items per day in the posting timezone).');
  }
  // Whether a wake re-reads our own activity page to learn which hours work.
  if (obj.post?.analytics !== undefined && typeof obj.post.analytics !== 'boolean') {
    errors.push('post.analytics must be true or false.');
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
      // Autopilot: the runner picks the best-reach hour from the day's hours and
      // waits for it. A string like "true" would be truthy in run.js, so only a
      // real boolean is accepted.
      if (sch.autopilot !== undefined && typeof sch.autopilot !== 'boolean') {
        errors.push('schedule.autopilot must be true or false.');
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
  const tg = obj.telegram;
  if (tg !== undefined) {
    if (!tg || typeof tg !== 'object' || Array.isArray(tg)) {
      errors.push('telegram must be an object.');
    } else {
      // The bot token can post into your chats, and this file syncs to the
      // cloud dashboard — keep it in state/telegram.token on the machine only.
      if (tg.token !== undefined || tg.botToken !== undefined || tg.apiKey !== undefined) {
        errors.push('Never store the Telegram bot token in the config — it belongs in state/telegram.token (npm run telegram:setup -- <token>).');
      }
      if (tg.enabled !== undefined && typeof tg.enabled !== 'boolean') errors.push('telegram.enabled must be true/false.');
      if (tg.useScheduledSlots !== undefined && typeof tg.useScheduledSlots !== 'boolean') errors.push('telegram.useScheduledSlots must be true/false.');
      if (tg.allowedChatIds !== undefined) {
        if (!Array.isArray(tg.allowedChatIds)) errors.push('telegram.allowedChatIds must be an array of chat id numbers.');
        else {
          if (tg.allowedChatIds.length > 20) errors.push('telegram.allowedChatIds is unreasonably large (>20).');
          if (tg.allowedChatIds.some((v) => !Number.isInteger(Number(v)) || Number(v) === 0)) {
            errors.push('telegram.allowedChatIds entries must be whole non-zero chat ids (the number the bot tells you, negative for groups).');
          }
        }
      }
      const mins = { windowMinutes: [10, 720], minLeadMinutes: [0, 120], reserveMinutes: [5, 120], pollTimeoutSeconds: [0, 50] };
      for (const [k, [lo, hi]] of Object.entries(mins)) {
        if (tg[k] !== undefined && !(Number.isInteger(tg[k]) && tg[k] >= lo && tg[k] <= hi)) {
          errors.push(`telegram.${k} must be an integer ${lo}–${hi}.`);
        }
      }
      if (tg.windowMinutes !== undefined && tg.reserveMinutes !== undefined && Number(tg.reserveMinutes) >= Number(tg.windowMinutes)) {
        errors.push('telegram.reserveMinutes must be smaller than windowMinutes — the run needs time inside the window.');
      }
      if (tg.freshnessHours !== undefined && !(Number.isInteger(tg.freshnessHours) && tg.freshnessHours >= 1 && tg.freshnessHours <= 168)) {
        errors.push('telegram.freshnessHours must be an integer 1–168 (how far back the web search reaches).');
      }
      if (tg.maxAgeHours !== undefined && !(Number.isInteger(tg.maxAgeHours) && tg.maxAgeHours >= 6 && tg.maxAgeHours <= 720)) {
        errors.push('telegram.maxAgeHours must be an integer 6–720 (the hard age cut for a publishable post).');
      }
      if (tg.tokenFile !== undefined && (typeof tg.tokenFile !== 'string' || !tg.tokenFile.trim() || tg.tokenFile.length > 200)) {
        errors.push('telegram.tokenFile must be a file path string.');
      }
      if (tg.weights !== undefined) {
        if (!tg.weights || typeof tg.weights !== 'object' || Array.isArray(tg.weights)) {
          errors.push('telegram.weights must be an object of {relevance, trending, recency} numbers.');
        } else {
          for (const k of ['relevance', 'trending', 'recency']) {
            if (tg.weights[k] !== undefined && !(Number(tg.weights[k]) >= 0 && Number(tg.weights[k]) <= 1)) {
              errors.push(`telegram.weights.${k} must be 0–1.`);
            }
          }
        }
      }
      // The yes-or-no step between research and publishing. src/approval.js
      // clamps these same ranges at load time, so a value the runner would
      // silently rewrite must be rejected here instead of saving and confusing
      // the owner about which number is actually in force.
      const ap = tg.approval;
      if (ap !== undefined) {
        if (!ap || typeof ap !== 'object' || Array.isArray(ap)) {
          errors.push('telegram.approval must be an object.');
        } else {
          if (ap.enabled !== undefined && typeof ap.enabled !== 'boolean') errors.push('telegram.approval.enabled must be true/false.');
          if (ap.answerHours !== undefined && !(Number(ap.answerHours) >= 0.5 && Number(ap.answerHours) <= 24)) {
            errors.push('telegram.approval.answerHours must be 0.5–24 hours (how long your yes is waited for).');
          }
          if (ap.holdDays !== undefined && !(Number.isInteger(ap.holdDays) && ap.holdDays >= 1 && ap.holdDays <= 7)) {
            errors.push('telegram.approval.holdDays must be an integer 1–7 (unanswered offers re-asked this many days, then dropped).');
          }
          if (ap.remindAfterHours !== undefined && !(Number(ap.remindAfterHours) >= 0.25 && Number(ap.remindAfterHours) <= 12)) {
            errors.push('telegram.approval.remindAfterHours must be 0.25–12 hours.');
          }
          if (ap.maxCandidates !== undefined && !(Number.isInteger(ap.maxCandidates) && ap.maxCandidates >= 1 && ap.maxCandidates <= 9)) {
            errors.push('telegram.approval.maxCandidates must be an integer 1–9 (menu size on Telegram).');
          }
          if (ap.bodyChars !== undefined && !(Number.isInteger(ap.bodyChars) && ap.bodyChars >= 500 && ap.bodyChars <= 20000)) {
            errors.push('telegram.approval.bodyChars must be an integer 500–20000 (article text kept per candidate).');
          }
          if (ap.answerHours !== undefined && ap.remindAfterHours !== undefined && Number(ap.remindAfterHours) >= Number(ap.answerHours)) {
            errors.push('telegram.approval.remindAfterHours must be shorter than answerHours — the nudge has to land before the deadline.');
          }
        }
      }
    }
  }
  // Web research — the source of the day's post since profile browsing was
  // banned. These feeds are keyless by design: a token here would be a secret
  // in a file that syncs to the dashboard.
  const rs = obj.research;
  if (rs !== undefined) {
    if (!rs || typeof rs !== 'object' || Array.isArray(rs)) {
      errors.push('research must be an object.');
    } else {
      if (rs.enabled !== undefined && typeof rs.enabled !== 'boolean') errors.push('research.enabled must be true/false.');
      if (rs.token !== undefined || rs.apiKey !== undefined) {
        errors.push('The web feeds need no key — never store a token or API key in research.');
      }
      if (rs.topics !== undefined) {
        if (!Array.isArray(rs.topics)) errors.push('research.topics must be an array of search phrases.');
        else {
          if (rs.topics.length > 30) errors.push('research.topics is unreasonably large (>30).');
          if (rs.topics.some((t) => typeof t !== 'string' || !t.trim() || t.length > 60)) {
            errors.push('research.topics entries must be non-empty phrases of ≤60 characters.');
          }
        }
      }
      const ints = { candidates: [1, 9], maxPerSource: [1, 30], topicWindowHours: [1, 168], dailyWindowHours: [1, 168], enrichMaxItems: [0, 20], enrichMaxBodyChars: [500, 20000] };
      for (const [k, [lo, hi]] of Object.entries(ints)) {
        if (rs[k] !== undefined && !(Number.isInteger(rs[k]) && rs[k] >= lo && rs[k] <= hi)) {
          errors.push(`research.${k} must be an integer ${lo}–${hi}.`);
        }
      }
      if (rs.enrich !== undefined && typeof rs.enrich !== 'boolean') errors.push('research.enrich must be true/false.');
      if (rs.timeoutMs !== undefined && !(Number.isInteger(rs.timeoutMs) && rs.timeoutMs >= 3000 && rs.timeoutMs <= 60000)) {
        errors.push('research.timeoutMs must be an integer 3000–60000 ms.');
      }
      for (const k of ['googleNews', 'hackerNews', 'reddit']) {
        if (rs[k] === undefined) continue;
        const s = rs[k];
        if (!s || typeof s !== 'object' || Array.isArray(s)) errors.push(`research.${k} must be an object.`);
        else if (s.enabled !== undefined && typeof s.enabled !== 'boolean') errors.push(`research.${k}.enabled must be true/false.`);
      }
      if (rs.googleNews !== undefined && rs.googleNews && !Array.isArray(rs.googleNews)) {
        for (const [k, re] of [['language', /^[a-z]{2}$/], ['locale', /^[A-Za-z]{2}$/], ['country', /^[A-Za-z]{2}$/]]) {
          if (rs.googleNews[k] !== undefined && !re.test(String(rs.googleNews[k]))) {
            errors.push(`research.googleNews.${k} must look like "${k === 'language' ? 'en' : 'IN'}" (a two-letter code).`);
          }
        }
      }
      if (rs.reddit?.subreddits !== undefined) {
        if (!Array.isArray(rs.reddit.subreddits)) errors.push('research.reddit.subreddits must be an array of names.');
        else {
          if (rs.reddit.subreddits.length > 20) errors.push('research.reddit.subreddits is unreasonably large (>20 — each one is a separate fetch).');
          if (rs.reddit.subreddits.some((s) => typeof s !== 'string' || !s.replace(/^\/?r\//i, '').trim() || s.length > 40)) {
            errors.push('research.reddit.subreddits entries must be subreddit names (e.g. "startups").');
          }
        }
      }
      if (rs.weights !== undefined) {
        if (!rs.weights || typeof rs.weights !== 'object' || Array.isArray(rs.weights)) {
          errors.push('research.weights must be an object of {relevance, trending, recency} numbers.');
        } else {
          for (const k of ['relevance', 'trending', 'recency']) {
            if (rs.weights[k] !== undefined && !(Number(rs.weights[k]) >= 0 && Number(rs.weights[k]) <= 1)) {
              errors.push(`research.weights.${k} must be 0–1.`);
            }
          }
        }
      }
    }
  }
  // The weekly newsletter. Every range here is the clamp src/newsletter.js
  // applies at load time — a value the runner would silently rewrite is rejected
  // here instead, so the owner never wonders which number is actually in force.
  const nl = obj.newsletter;
  if (nl !== undefined) {
    if (!nl || typeof nl !== 'object' || Array.isArray(nl)) {
      errors.push('newsletter must be an object.');
    } else {
      if (nl.token !== undefined || nl.apiKey !== undefined) {
        errors.push('The newsletter reads keyless public feeds — never store a token or API key in newsletter.');
      }
      for (const k of ['enabled', 'versionLadder', 'attachInfographic', 'plainLanguage']) {
        if (nl[k] !== undefined && typeof nl[k] !== 'boolean') errors.push(`newsletter.${k} must be true/false.`);
      }
      if (nl.name !== undefined && (typeof nl.name !== 'string' || !nl.name.trim() || nl.name.length > 80)) {
        errors.push('newsletter.name must be a non-empty name of ≤80 characters.');
      }
      if (nl.day !== undefined && !WEEKDAYS.includes(String(nl.day))) {
        errors.push('newsletter.day must be a three-letter weekday: Sun, Mon, Tue, Wed, Thu, Fri or Sat.');
      }
      // The calendar. Each row is one issue: the weekdays it runs on, the hour it
      // lands, and whether it is switched on. Twice a day is two all-week rows.
      if (nl.events !== undefined) {
        if (!Array.isArray(nl.events)) {
          errors.push('newsletter.events must be an array of rows: { name, days: [], hour, on }.');
        } else {
          if (nl.events.length > 6) errors.push('newsletter.events holds at most 6 rows.');
          for (const [i, e] of nl.events.entries()) {
            const at = `newsletter.events row ${i + 1}`;
            if (!e || typeof e !== 'object' || Array.isArray(e)) { errors.push(`${at} must be an object with days and an hour.`); continue; }
            if (e.name !== undefined && (typeof e.name !== 'string' || !e.name.trim() || e.name.length > 40)) {
              errors.push(`${at} needs a name of ≤40 characters.`);
            }
            if (!Array.isArray(e.days) || !e.days.length || e.days.some((d) => !WEEKDAYS.includes(String(d)))) {
              errors.push(`${at} needs days: a list of Sun, Mon, Tue, Wed, Thu, Fri, Sat.`);
            }
            if (!(Number.isInteger(e.hour) && e.hour >= 0 && e.hour <= 23)) errors.push(`${at} needs an hour 0–23.`);
            if (e.on !== undefined && typeof e.on !== 'boolean') errors.push(`${at} on must be true or false.`);
          }
          const live = nl.events.filter((e) => e && typeof e === 'object');
          const keys = live.map((e) => `${[...(e.days ?? [])].sort().join('+')}@${e.hour}`);
          if (new Set(keys).size !== keys.length) errors.push('two newsletter.events rows would land on the same days at the same hour — name them differently.');
          if (live.length && live.every((e) => e.on === false)) errors.push('every newsletter.events row is switched off, so nothing would ever be drafted.');
        }
      }
      if (nl.footer !== undefined && (typeof nl.footer !== 'string' || nl.footer.length > 300)) {
        errors.push('newsletter.footer must be a string of ≤300 characters (or empty).');
      }
      const ints = { draftHour: [0, 23], windowHours: [6, 720], sections: [1, 8], itemsPerSection: [1, 6], useCases: [0, 3], maxPostChars: [600, 2900], hashtagCount: [0, 15] };
      for (const [k, [lo, hi]] of Object.entries(ints)) {
        if (nl[k] !== undefined && !(Number.isInteger(nl[k]) && nl[k] >= lo && nl[k] <= hi)) {
          errors.push(`newsletter.${k} must be an integer ${lo}–${hi}.`);
        }
      }
      for (const k of ['topics', 'extraHashtags', 'feedback']) {
        if (nl[k] === undefined) continue;
        if (!Array.isArray(nl[k])) errors.push(`newsletter.${k} must be an array of strings.`);
        else if (nl[k].some((t) => typeof t !== 'string' || !t.trim())) {
          errors.push(`newsletter.${k} entries must be non-empty strings.`);
        } else if (k === 'topics' && (nl[k].length > 30 || nl[k].some((t) => t.length > 60))) {
          errors.push('newsletter.topics is limited to 30 search phrases of ≤60 characters each.');
        } else if (k === 'extraHashtags' && (nl[k].length > 20 || nl[k].some((t) => /[\s#]/.test(t) || t.length > 30))) {
          errors.push('newsletter.extraHashtags entries must be plain words (no spaces/#, ≤30 chars), max 20.');
        } else if (k === 'feedback' && (nl[k].length > 30 || nl[k].some((t) => t.length > 300))) {
          errors.push('newsletter.feedback holds up to 30 notes of ≤300 characters — older notes are already applied.');
        }
      }
      // useCaseLines: your own "You can …" line per tool family or theme name.
      if (nl.useCaseLines !== undefined) {
        if (!nl.useCaseLines || typeof nl.useCaseLines !== 'object' || Array.isArray(nl.useCaseLines)) {
          errors.push('newsletter.useCaseLines must be an object of {"tool name": "You can …"} lines.');
        } else {
          const entries = Object.entries(nl.useCaseLines);
          if (entries.length > 40) errors.push('newsletter.useCaseLines is limited to 40 lines.');
          if (entries.some(([k, v]) => !String(k).trim() || typeof v !== 'string' || !v.trim() || v.length > 200)) {
            errors.push('newsletter.useCaseLines entries must be a name and a non-empty sentence of ≤200 characters.');
          }
        }
      }
      // Extra themes/product families: the built-in lists plus these.
      for (const [k, key, label] of [['themes', 'keywords', 'name'], ['products', 'aliases', 'family']]) {
        if (nl[k] === undefined) continue;
        if (!Array.isArray(nl[k])) errors.push(`newsletter.${k} must be an array of { ${label}, ${key}: [] } objects.`);
        else if (nl[k].length > 30) errors.push(`newsletter.${k} is limited to 30 entries.`);
        else if (nl[k].some((e) => !e || typeof e !== 'object' || !String(e[label] ?? '').trim() || !Array.isArray(e[key]) || !e[key].length)) {
          errors.push(`newsletter.${k} entries each need a ${label} and a non-empty ${key} array of strings.`);
        } else if (nl[k].some((e) => e[key].some((w) => typeof w !== 'string' || !w.trim() || w.length > 40))) {
          errors.push(`newsletter.${k} ${key} entries must be short words (≤40 characters).`);
        }
      }
      // The practical redesign: what a flow may cost, how many per week, and the
      // page each one links to. Same ranges as nlCfg()/clampInt() in the runner.
      if (nl.style !== undefined && !['practical', 'release'].includes(String(nl.style))) {
        errors.push('newsletter.style must be "practical" (a list of DIY flows) or "release" (the version ladder).');
      }
      if (nl.useCaseCount !== undefined && !(Number.isInteger(nl.useCaseCount) && nl.useCaseCount >= 0 && nl.useCaseCount <= 12)) {
        errors.push('newsletter.useCaseCount must be an integer 0–12 (how many flows one issue carries).');
      }
      if (nl.maxCost !== undefined && !['free', 'signup', 'free-tier', 'paid'].includes(String(nl.maxCost))) {
        errors.push('newsletter.maxCost must be free, signup, free-tier or paid.');
      }
      if (nl.redditSubreddit !== undefined) {
        const sub = String(nl.redditSubreddit);
        if (sub !== sub.trim() || (sub && !/^r?[\/]?[\w-]{1,21}$/.test(sub))) {
          errors.push('newsletter.redditSubreddit is one subreddit name, with or without the r/ — e.g. "artificial".');
        }
      }
      const st = nl.site;
      if (st !== undefined) {
        if (!st || typeof st !== 'object' || Array.isArray(st)) {
          errors.push('newsletter.site must be an object of { name, baseUrl, outDir }.');
        } else {
          for (const k of ['name', 'baseUrl', 'outDir']) {
            if (st[k] !== undefined && typeof st[k] !== 'string') errors.push(`newsletter.site.${k} must be a string (use "" for the default).`);
          }
          if (st.name !== undefined && (!st.name.trim() || st.name.length > 80)) errors.push('newsletter.site.name must be a non-empty name of ≤80 characters.');
          if (st.outDir !== undefined && st.outDir.length > 200) errors.push('newsletter.site.outDir must be a folder path of ≤200 characters.');
          // A half-typed URL is worse than none: it becomes a dead link in a post.
          if (st.baseUrl && !/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s]*)?$/i.test(String(st.baseUrl).replace(/\/+$/, ''))) {
            errors.push('newsletter.site.baseUrl must be a full https:// address, e.g. "https://flows.example.com", or "" for no links.');
          }
        }
      }
      const ch = nl.channels;
      if (ch !== undefined) {
        if (!ch || typeof ch !== 'object' || Array.isArray(ch)) {
          errors.push('newsletter.channels must be an object of { linkedin: true/false, reddit: true/false }.');
        } else {
          for (const k of ['linkedin', 'reddit']) {
            if (ch[k] !== undefined && typeof ch[k] !== 'boolean') errors.push(`newsletter.channels.${k} must be true/false.`);
          }
          if (ch.linkedin === false && ch.reddit !== true) {
            errors.push('newsletter.channels cannot aim at nothing — leave linkedin true, or set reddit with a redditSubreddit.');
          }
          if (ch.reddit === true && !String(nl.redditSubreddit ?? '').trim()) {
            errors.push('newsletter.channels.reddit is true but newsletter.redditSubreddit is empty — name the subreddit or leave reddit false.');
          }
        }
      }
      const ap = nl.approval;
      if (ap !== undefined) {
        if (!ap || typeof ap !== 'object' || Array.isArray(ap)) {
          errors.push('newsletter.approval must be an object.');
        } else {
          if (ap.answerHours !== undefined && !(Number(ap.answerHours) >= 0.5 && Number(ap.answerHours) <= 24)) {
            errors.push('newsletter.approval.answerHours must be 0.5–24 hours (how long your /nl yes is waited for).');
          }
          if (ap.holdDays !== undefined && !(Number.isInteger(ap.holdDays) && ap.holdDays >= 1 && ap.holdDays <= 7)) {
            errors.push('newsletter.approval.holdDays must be an integer 1–7 (an unanswered issue is re-offered this many days, then dropped).');
          }
          if (ap.remindAfterHours !== undefined && !(Number(ap.remindAfterHours) >= 0.25 && Number(ap.remindAfterHours) <= 12)) {
            errors.push('newsletter.approval.remindAfterHours must be 0.25–12 hours.');
          }
          if (ap.answerHours !== undefined && ap.remindAfterHours !== undefined && Number(ap.remindAfterHours) >= Number(ap.answerHours)) {
            errors.push('newsletter.approval.remindAfterHours must be shorter than answerHours — the nudge has to land before the deadline.');
          }
        }
      }
      const ig = nl.infographic;
      if (ig !== undefined) {
        if (!ig || typeof ig !== 'object' || Array.isArray(ig)) {
          errors.push('newsletter.infographic must be an object of { width, height, scale, accent }.');
        } else {
          const sizes = { width: [720, 1600], height: [720, 4000], scale: [1, 3] };
          for (const [k, [lo, hi]] of Object.entries(sizes)) {
            if (ig[k] !== undefined && !(Number(ig[k]) >= lo && Number(ig[k]) <= hi)) {
              errors.push(`newsletter.infographic.${k} must be ${lo}–${hi}${k === 'scale' ? ' (pixels per point)' : ' px'}.`);
            }
          }
          if (ig.accent !== undefined && !/^#[0-9a-f]{6}$/i.test(String(ig.accent))) {
            errors.push('newsletter.infographic.accent must be a hex colour like "#4f46e5".');
          }
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
