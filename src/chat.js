/**
 * Free-tier chat caller: one OpenAI-compatible `/chat/completions` request
 * shape, with the resilience a $0 quota needs.
 *
 * Free pools are shared, so a model can 429 because *someone else* is busy —
 * that must not cost the run its AI text. Strategy:
 *   pass 1 — try each configured model once (llm.model, then llm.fallbackModels)
 *            with the full body; on 400/422 immediately retry that model with a
 *            relaxed body (free providers often reject temperature /
 *            response_format / max_tokens), and on a 200 with empty content
 *            retry once with that relaxed body too.
 *   pass 2 — if every candidate was throttled (429), wait llm.retryDelayMs and
 *            retry those, since upstream saturation is usually momentary.
 * Gives up only after that, and the callers then use their no-AI fallback
 * (pool comment / extractive rewrite), so a run can never fail on this.
 *
 * Never throws: a network/timeout failure demotes that model and moves on.
 * The API key is passed in already resolved and is never logged.
 */
import { DEFAULT_LLM } from './providers.js';

export function modelList(llm) {
  const list = [llm?.model || DEFAULT_LLM.model, ...(Array.isArray(llm?.fallbackModels) ? llm.fallbackModels : [])]
    .map((m) => (typeof m === 'string' ? m.trim() : ''))
    .filter(Boolean);
  return [...new Set(list)];
}

export async function chatCompletion({ llm, base, key, buildBody, log, label = 'LLM' }) {
  const models = modelList(llm);
  if (!models.length) return null;
  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  const timeoutMs = Number(llm?.timeoutMs) || 45000;

  const send = async (model, relax) => {
    try {
      const { body, relaxBody } = buildBody(model);
      const payload = relax ? relaxBody : body;
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text().catch(() => '');
      return { status: res.status, json: text ? safeJson(text) : null, text };
    } catch (err) {
      // Timeout / network: treat like a dead candidate rather than killing the run.
      log?.(`[${label}] ${model} failed (${err.message}).`);
      return { status: 0, json: null, text: '' };
    }
  };

  // A 200 with no usable content counts as a miss too (some free routers 200 empty).
  const usable = (out) => out.status === 200 && Boolean(contentOf(out.json));

  const attempts = [];
  const runPass = async (candidates, allowRelaxed) => {
    const throttled = [];
    for (const model of candidates) {
      let out = await send(model, false);
      attempts.push({ model, status: out.status });
      if (out.status === 429) { throttled.push(model); continue; }
      const drop = llm?.dropSamplingParams !== false;
      if ((out.status === 400 || out.status === 422) && allowRelaxed && drop) {
        log?.(`[${label}] ${model} rejected the request shape (${out.status}) — retrying plain.`);
        out = await send(model, true);
        attempts.push({ model, status: out.status });
      } else if (out.status === 200 && !contentOf(out.json) && allowRelaxed) {
        // Free reasoning routers can answer 200 with an empty message when the
        // token budget is consumed by hidden thinking — the uncapped relaxed
        // body usually gets the real text.
        log?.(`[${label}] ${model} returned empty content — retrying plain.`);
        out = await send(model, true);
        attempts.push({ model, status: out.status });
      }
      if (usable(out)) return { model, out };
      log?.(`[${label}] ${model} → HTTP ${out.status}${out.status ? `: ${errorText(out)}` : ''}`);
    }
    return { throttled };
  };

  let result = await runPass(models, true);
  if (result.out) return finish(result, log, label);

  if (result.throttled.length) {
    const wait = Number(llm?.retryDelayMs) || 8000;
    log?.(`[${label}] ${result.throttled.length} model(s) throttled by the free pool — waiting ${wait / 1000}s, retrying.`);
    await new Promise((r) => setTimeout(r, wait));
    result = await runPass(result.throttled, true);
    if (result.out) return finish(result, log, label);
  }

  log?.(`[${label}] no free model answered (${attempts.map((a) => `${a.model}:${a.status}`).join(', ') || 'no attempt'}) — using fallback.`);
  return null;
}

function finish({ model, out }, log, label) {
  const used = out.json?.choices?.[0]?.message ?? {};
  const raw = String(used.content ?? out.json?.choices?.[0]?.text ?? '');
  // Reasoning models prepend a think block; keep only the text after the last marker.
  const parts = raw.split(/<\/think>|<｜end▁of▁thinking｜>|<\|end_of_thinking\|>/i);
  const text = parts[parts.length - 1].trim();
  log?.(`[${label}] used ${model}.`);
  return { model, text: text || contentOf(out.json) || '' };
}

function contentOf(json) {
  const m = json?.choices?.[0]?.message ?? {};
  return (m.content ?? json?.choices?.[0]?.text ?? '').toString().trim();
}

function errorText(out) {
  const e = out.json?.error;
  const msg = typeof e === 'string' ? e : e?.message ?? out.text ?? '';
  return String(msg).replace(/\s+/g, ' ').slice(0, 140);
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
