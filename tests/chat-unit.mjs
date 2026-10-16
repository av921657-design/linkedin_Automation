// Offline unit test for src/chat.js + its callers (stubbed fetch, no network,
// no key). Run with: npm run test:llm
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.CHAT_TEST_KEY = 'test-key-stub-only';
const calls = [];
let script = []; // queue of (payload) => ({status, body})
globalThis.fetch = async (url, opts) => {
  const payload = JSON.parse(opts.body);
  calls.push({ payload, headers: opts.headers });
  const next = script.length > 1 ? script.shift() : script[script.length - 1] ?? (() => ({ status: 599, body: '' }));
  const out = next(payload);
  return {
    status: out.status,
    text: async () => (typeof out.body === 'string' ? out.body : JSON.stringify(out.body)),
  };
};
const ok = (content) => ({ status: 200, body: { choices: [{ message: { content } }] } });
const THINK = '<think>hidden reasoning</' + 'think>Real reply here.';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// import() needs a file:// URL — a bare "D:\…" or "/home/…" path is rejected
// as an unsupported URL scheme on Windows.
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const { chatCompletion, modelList } = await mod('src/chat.js');
const { generateComment } = await mod('src/comment.js');
const { rewriteForPost, qualityChecks, unicodeBold } = await mod('src/summarize.js');
const { validateConfig } = await mod('dashboard/lib/validate.js');

let passed = 0;
const check = (name, cond) => {
  if (!cond) { console.error(`FAIL: ${name}`); process.exit(1); }
  passed += 1;
  console.log(`ok: ${name}`);
};

const baseLlm = {
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'main:free',
  fallbackModels: ['fb1:free', 'fb2:free'],
  apiKeyEnv: 'CHAT_TEST_KEY',
  retryDelayMs: 10,
};

check('modelList dedupes', modelList({ model: 'a', fallbackModels: ['a', ' b ', ''] }).join(',') === 'a,b');
check('modelList defaults when unset', modelList({})[0].includes(':free'));

// 1) comment path: main 429 -> fallback answers; think-block + quotes cleaned
calls.length = 0;
script = [
  () => ({ status: 429, body: '{"error":{"message":"rate limited"}}' }),
  () => ok('"' + THINK + '"'),
];
const logs = [];
const comment = await generateComment({
  postText: 'Ops teams should count escalations avoided.',
  authorName: 'A Creator',
  llm: baseLlm,
  log: (m) => logs.push(m),
});
check('fallback answered after 429', comment === 'Real reply here.');
check('auth header sent', calls[0].headers.authorization === 'Bearer test-key-stub-only');
check('second call used fb1', calls[1].payload.model === 'fb1:free');

// 2) all throttled -> pass 2 retries after wait, then give up -> null
calls.length = 0;
script = [() => ({ status: 429, body: '{}' })];
const none = await generateComment({ postText: 'abc def ghi', llm: { ...baseLlm, fallbackModels: [] }, log: () => {} });
check('all-429 gives null', none === null);
check('throttle retried once', calls.length === 2);

// 3) rewrite path: 400 on full body -> relaxed retry -> fenced JSON parsed
calls.length = 0;
const T = Array(25).fill('insight').join(' ');
const json = JSON.stringify({
  heading: 'Measure What Matters',
  takeaways: [T, T, T],
  bullets: [
    'The Core Idea - tickets closed say little about real health',
    'Upstream Fixes - moving lessons to checklists prevents escalations',
    'Team Load - the same headcount absorbs far more volume',
    'Compounding Wins - avoided tickets grow quietly every week',
    'Next Step - track escalations avoided as the primary metric',
  ],
  imageStatus: 'the article linked a cover we could not fetch',
});
script = [
  (p) => (p.response_format ? { status: 400, body: '{"error":{"message":"no response_format"}}' } : ok('```json\n' + json + '\n```')),
];
const candidate = {
  summarize: true,
  text: 'Measure escalations avoided\n\nBody body body body body body body body body body.',
  articleUrl: 'https://example.com/article',
  sourceType: 'substack',
};
const cfg = { enabled: true, mode: 'llm', attribution: true, template: { enabled: true, takeawayWords: 25, bullets: 5, footer: '' }, llm: { ...baseLlm, fallbackModels: [] } };
const post = await rewriteForPost(candidate, cfg, () => {});
check('relaxed retry produced structured post', post.includes(unicodeBold('Measure What Matters')) && post.includes('Full article: https://example.com/article'));
check('post passes quality checks', qualityChecks(post, { takeawayWords: 25, bullets: 5, source: true }).length === 0);
check('relaxed body drops response_format', calls[1].payload.response_format === undefined && calls[0].payload.response_format !== undefined);

// 4) 200-empty: relaxed retry rescues it when the plain body has content
calls.length = 0;
script = [(p) => (p.temperature !== undefined ? ok('   ') : ok('Recovered text.'))];
const rescued = await chatCompletion({
  llm: { ...baseLlm, fallbackModels: [] }, base: 'https://x.test/v1', key: 'k', log: () => {},
  buildBody: (model) => ({ body: { model, temperature: 0.5 }, relaxBody: { model } }),
});
check('200-empty retried relaxed and recovered', rescued?.text === 'Recovered text.');

// 4b) still-empty after relaxed retry counts as a miss -> null
calls.length = 0;
script = [() => ok('   ')];
const empty = await chatCompletion({ llm: { ...baseLlm, fallbackModels: [] }, base: 'https://x.test/v1', key: 'k', buildBody: (model) => ({ body: { model, temperature: 0.5 }, relaxBody: { model } }), log: () => {} });
check('persistent 200-empty gives null', empty === null);

// 5) dashboard validation accepts / rejects fallbackModels
const base = { sources: [], rewrite: { llm: { baseUrl: 'https://openrouter.ai/api/v1', model: 'm', fallbackModels: ['a:free', 'b:free'] } } };
check('validate accepts fallbackModels', validateConfig(base).ok);
const bad = { sources: [], rewrite: { llm: { baseUrl: 'https://openrouter.ai/api/v1', model: 'm', fallbackModels: 'a, b' } } };
const badRes = validateConfig(bad);
check('validate rejects non-array', !badRes.ok && badRes.errors.some((e) => e.includes('fallbackModels')));

console.log(`\n${passed} unit checks passed.`);
