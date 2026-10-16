'use client';

import { useId } from 'react';
import { Check, Txt, TxtList, Num, Select } from './controls';
import { PROVIDERS, matchProvider } from '../lib/providers';

const MODES = [
  ['auto', 'auto — LLM if a key exists, else offline builder'],
  ['llm', 'llm — always the AI model'],
  ['extractive', 'extractive — offline, no API ever'],
];

export function Rewrite({ cfg, update }) {
  const footerId = useId();
  const rw = () => cfg.rewrite ?? {};
  const tp = () => rw().template ?? {};
  const setRew = (patch) => update((d) => { d.rewrite = { ...(d.rewrite ?? {}), ...patch }; });
  // `rewrite` is optional in the schema, so the nested block has to be read off
  // the copy, not off `d.rewrite` — which the same expression is replacing.
  const setTmpl = (patch) =>
    update((d) => {
      const next = { ...(d.rewrite ?? {}) };
      next.template = { ...(next.template ?? {}), ...patch };
      d.rewrite = next;
    });
  const setLlm = (patch) =>
    update((d) => {
      const next = { ...(d.rewrite ?? {}) };
      next.llm = { ...(next.llm ?? {}), ...patch };
      d.rewrite = next;
    });
  const llmPreset = matchProvider(rw().llm?.baseUrl);

  return (
    <div className="panel">
      <div className="card">
        <h2>Article rewriting <span className={`pill ${rw().enabled !== false ? 'on' : 'off'}`}>{rw().enabled !== false ? 'on' : 'off'}</span></h2>
        <p className="hint">Turns Substack / Medium / blog sources into short LinkedIn posts. Off = those sources are skipped for rewriting and posted as scraped (or not at all).</p>
        <div className="grid-3">
          <Check label="rewriting enabled" get={() => rw().enabled !== false} set={(v) => setRew({ enabled: v })} />
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <Select label="engine mode" get={() => rw().mode ?? 'auto'} set={(v) => setRew({ mode: v })} options={MODES} />
          </div>
        </div>
        <p className="hint" style={{ marginTop: 8 }}><b>Extractive</b> is the built-in offline builder (no API, exact word counts). <b>LLM</b> uses the free model in the AI engine card. <b>auto</b> picks the LLM when the Mac has a key, otherwise falls back to extractive — never fails a post.</p>
        <div className="grid-2" style={{ marginTop: 6 }}>
          <Num label="target characters (plain summary)" get={() => rw().targetChars ?? 900} set={(v) => setRew({ targetChars: v ?? 900 })} />
          <Num label="max sentences (plain summary)" get={() => rw().maxSentences ?? 7} set={(v) => setRew({ maxSentences: v ?? 7 })} />
        </div>
        <p className="hint">These two shape the <i>plain</i> summary used only when the structured template (below) is off. The template ignores them.</p>
        <div className="grid-2" style={{ marginTop: 6 }}>
          <Txt label="attribution line" mono get={() => rw().attributionText ?? '🔗 Full article: {url}'} set={(v) => setRew({ attributionText: v })} />
          <div style={{ paddingTop: 18 }}>
            <Check label="append source link" get={() => rw().attribution !== false} set={(v) => setRew({ attribution: v })} />
          </div>
        </div>
        <p className="hint">Keep the source link on: summarising with credit is safe curation; silently rewriting someone's article is not.</p>
      </div>

      <div className="card">
        <h2>Structured article template <span className={`pill ${tp().enabled !== false ? 'on' : 'off'}`}>{tp().enabled !== false ? 'active' : 'off'}</span></h2>
        <p className="hint">Shape for Substack/Medium rewrites: bold heading, numbered takeaways of exactly N words (validated), N bullets with bold intros, source link, footer.</p>
        <div className="grid-3">
          <Check label="template enabled" get={() => tp().enabled !== false} set={(v) => setTmpl({ enabled: v })} />
          <Num label="words per takeaway" get={() => tp().takeawayWords ?? 25} set={(v) => setTmpl({ takeawayWords: v ?? 25 })} />
          <Num label="bullet points" get={() => tp().bullets ?? 5} set={(v) => setTmpl({ bullets: v ?? 5 })} />
        </div>
        <div className="grid-2" style={{ marginTop: 8 }}>
          <Num label="relevant hashtags per article post" get={() => tp().hashtagCount ?? 10} set={(v) => setTmpl({ hashtagCount: v ?? 10 })} />
        </div>
        <h3 id={footerId}>Footer — appended to every article post</h3>
        <textarea rows={3} aria-labelledby={footerId} value={tp().footer ?? ''} onChange={(e) => setTmpl({ footer: e.target.value })} />
      </div>

      <div className="card">
        <h2>AI engine — free providers <span className="pill on">no paid key</span></h2>
        <p className="hint">
          “auto” uses the model below when a key exists on the Mac, otherwise the built-in extractive builder.
          Both enforce the exact word counts. The key never lives here — on the Mac run <code>npm run llm:setup</code>,
          verify with <code>npm run llm:check</code>.
        </p>
        <div className="presets">
          {PROVIDERS.map((p) => {
            const active = llmPreset?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`preset${active ? ' active' : ''}`}
                title={p.note}
                onClick={() => setLlm({ baseUrl: p.baseUrl, model: p.model, fallbackModels: (p.models ?? []).filter((m) => m !== p.model).slice(0, 2), noAuth: p.noAuth ? true : undefined })}
              >
                {p.label} <span className="tag">{p.badge}</span>
              </button>
            );
          })}
        </div>
        {llmPreset ? (
          <p className="hint" style={{ marginTop: 8 }}>
            {llmPreset.note}{' '}
            {llmPreset.noAuth
              ? 'Runs locally on the Mac — no key at all.'
              : <>Get a free key at <a href={llmPreset.signupUrl} target="_blank" rel="noreferrer">{llmPreset.signupUrl.replace('https://', '')}</a> and paste it on the Mac.</>}
          </p>
        ) : (
          <p className="hint" style={{ marginTop: 8 }}>Custom endpoint — any OpenAI-compatible <code>/chat/completions</code> base url works.</p>
        )}
        <div className="grid-2">
          <TxtList label="model" get={() => rw().llm?.model} set={(v) => setLlm({ model: v })} options={llmPreset?.models ?? []} />
          <Txt label="API base url" mono get={() => rw().llm?.baseUrl} set={(v) => setLlm({ baseUrl: v })} />
        </div>
        <div style={{ marginTop: 10 }}>
          <Txt label="fallback models (comma separated)" mono get={() => (rw().llm?.fallbackModels ?? []).join(', ')} set={(v) => setLlm({ fallbackModels: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
          <p className="hint">Tried in order when the main model is throttled (429) or rejects the request — free pools are shared, so brief 429s are normal. Empty keeps it single-model.</p>
        </div>
        <div className="grid-2" style={{ marginTop: 10 }}>
          <Txt label="key env var name (Mac)" mono get={() => rw().llm?.apiKeyEnv ?? 'REWRITE_API_KEY'} set={(v) => setLlm({ apiKeyEnv: v })} hint="The NAME of the env var on the Mac — never the key itself." />
          <Txt label="key file path (Mac)" mono get={() => rw().llm?.apiKeyFile ?? 'state/rewrite.key'} set={(v) => setLlm({ apiKeyFile: v })} hint="Path on the Mac the key is read from. Set to false (Raw JSON) to force extractive." />
        </div>
        <div className="grid-2" style={{ marginTop: 10 }}>
          <Num label="request timeout (ms)" get={() => rw().llm?.timeoutMs ?? 45000} set={(v) => setLlm({ timeoutMs: v ?? 45000 })} />
          <Num label="retry backoff after 429 (ms)" get={() => rw().llm?.retryDelayMs ?? 8000} set={(v) => setLlm({ retryDelayMs: v ?? 8000 })} />
        </div>
        <p className="hint">timeout is per HTTP call; retryDelay is how long chat.js waits before rotating to a fallback model when a free model is throttled.</p>
      </div>
    </div>
  );
}
