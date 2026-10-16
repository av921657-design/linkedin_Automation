/**
 * Free LLM providers — OpenAI-compatible chat endpoints that cost nothing.
 *
 * The automation only needs short text jobs (article → structured post, and a
 * 1–2 sentence comment on someone else's post), a handful of calls per day.
 * Every provider below has a free tier that comfortably covers that volume,
 * and all of them speak the same `/chat/completions` shape the code already
 * uses, so switching is a config change — never a code change.
 *
 * The API key is NEVER stored in config or in the dashboard. It lives on this
 * Mac only: env var (llm.apiKeyEnv) or a git-ignored file (llm.apiKeyFile,
 * default state/rewrite.key, mode 0600). `npm run llm:setup` writes that file
 * with hidden input; `npm run llm:check` verifies the endpoint without printing
 * the key. Local providers (Ollama) need no key at all — set `noAuth: true`.
 */

export const PROVIDERS = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    badge: 'free',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemma-4-31b-it:free',
    models: [
      'google/gemma-4-31b-it:free',
      'google/gemma-4-26b-a4b-it:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
    ],
    signupUrl: 'https://openrouter.ai/settings/keys',
    cardRequired: false,
    note: 'One key, many models — anything ending in ":free" costs nothing. Free accounts are capped (a few dozen calls/day, ~20/min); this app needs roughly 6–18/day, so it fits. Model ids change often — check openrouter.ai/models?max_price=0.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    badge: 'free',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.6-flash',
    models: ['gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'],
    signupUrl: 'https://aistudio.google.com/apikey',
    cardRequired: false,
    note: 'Free key in ~1 min from Google AI Studio, no card. Use gemini-3.1-flash-lite if you ever hit 429s.',
  },
  {
    id: 'groq',
    label: 'Groq',
    badge: 'free',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.1-8b-instant',
    models: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
    signupUrl: 'https://console.groq.com/keys',
    cardRequired: false,
    note: 'Fastest free tier and the largest daily request allowance; Llama quality is a little below Gemma/Gemini for exact word-count templates.',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    badge: 'free · offline',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3:4b',
    models: ['qwen3:4b', 'llama3.2:3b', 'gemma3:4b'],
    signupUrl: 'https://ollama.com/download',
    cardRequired: false,
    noAuth: true,
    note: 'Zero sign-up, zero network: install Ollama, run `ollama pull qwen3:4b`, keep it running. Slower on CPU and weaker at the exact-word-count template.',
  },
];

/** The block the runner falls back to when config has no llm section. */
export const DEFAULT_LLM = {
  baseUrl: PROVIDERS[0].baseUrl,
  model: PROVIDERS[0].model,
  apiKeyEnv: 'REWRITE_API_KEY',
  apiKeyFile: 'state/rewrite.key',
  timeoutMs: 45000,
};

/** Which preset a baseUrl matches (for the dashboard label) — null for custom. */
export function matchProvider(baseUrl) {
  const b = String(baseUrl ?? '').replace(/\/+$/, '').toLowerCase();
  if (!b) return null;
  return PROVIDERS.find((p) => p.baseUrl.replace(/\/+$/, '').toLowerCase() === b) ?? null;
}

/** True when this llm block needs no key (local endpoint). */
export function keyless(llm) {
  return llm?.noAuth === true || Boolean(matchProvider(llm?.baseUrl)?.noAuth);
}
