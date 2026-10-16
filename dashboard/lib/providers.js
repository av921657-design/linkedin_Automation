/**
 * Free, OpenAI-compatible LLM providers offered as one-click presets.
 * Mirrors src/providers.js on the Mac (the dashboard is its own Next app and
 * cannot import from there) — keep the two lists in step.
 *
 * The dashboard only stores baseUrl + model. API keys NEVER live here: they
 * stay on the Mac in `state/rewrite.key` (or env REWRITE_API_KEY), written by
 * `npm run llm:setup`. Switching provider here takes effect on the next
 * scheduled run; the Mac falls back to static pool comments / the extractive
 * rewrite builder whenever no key is available.
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
    note: 'One key, many models — anything ending in ":free" costs nothing. Free accounts are capped to a few dozen calls a day; this app needs ~6–18. Model ids rotate: openrouter.ai/models?max_price=0.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    badge: 'free',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.6-flash',
    models: ['gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'],
    signupUrl: 'https://aistudio.google.com/apikey',
    note: 'Free key, no card needed. Use gemini-3.1-flash-lite if you ever hit 429s.',
  },
  {
    id: 'groq',
    label: 'Groq',
    badge: 'free',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.1-8b-instant',
    models: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
    signupUrl: 'https://console.groq.com/keys',
    note: 'Largest free daily allowance and very fast.',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    badge: 'local',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3:4b',
    models: ['qwen3:4b', 'llama3.2:3b', 'gemma3:4b'],
    signupUrl: 'https://ollama.com/download',
    noAuth: true,
    note: 'No key, no network. Install Ollama on the Mac and `ollama pull qwen3:4b`.',
  },
];

export function matchProvider(baseUrl) {
  const b = String(baseUrl ?? '').replace(/\/+$/, '').toLowerCase();
  if (!b) return null;
  return PROVIDERS.find((p) => p.baseUrl.replace(/\/+$/, '').toLowerCase() === b) ?? null;
}
