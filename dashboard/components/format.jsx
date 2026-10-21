'use client';

import { useId, useMemo } from 'react';
import { Check, Txt, Num } from './controls';
import { linesToTags } from '../lib/ui';

export function Format({ cfg, update }) {
  const poolId = useId();
  const r = () => cfg.reformat ?? {};
  const auto = () => r().autoHashtags ?? {};
  const poolText = useMemo(() => (auto().pool ?? []).join('\n'), [cfg]);

  // `reformat` is optional in the schema, so every writer has to materialise
  // it (and its nested blocks) before assigning — reading `d.reformat.x` on
  // the right-hand side of that same assignment would throw.
  const setR = (patch) => update((d) => { d.reformat = { ...(d.reformat ?? {}), ...patch }; });
  const setAuto = (patch) =>
    update((d) => {
      const next = { ...(d.reformat ?? {}) };
      next.autoHashtags = { ...(next.autoHashtags ?? {}), ...patch };
      d.reformat = next;
    });
  const setStyle = (patch) =>
    update((d) => {
      const next = { ...(d.reformat ?? {}) };
      next.style = { ...(next.style ?? {}), ...patch };
      d.reformat = next;
    });

  return (
    <div className="panel">
      <div className="card">
        <h2>Hashtags</h2>
        <div className="grid-3">
          <Check label="auto-hashtags on" get={() => auto().enabled !== false} set={(v) => setAuto({ enabled: v })} />
          <Num label="min tags (reposts)" get={() => auto().min ?? 10} set={(v) => setAuto({ min: v ?? 10 })} />
          <Num label="max tags (reposts)" get={() => auto().max ?? 15} set={(v) => setAuto({ max: v ?? 15 })} />
        </div>
        <h3 id={poolId}>Curated tag pool — one per line</h3>
        <p className="hint">Reposts draw 10–15 randomly from here; article posts use the most relevant ones.</p>
        <textarea
          rows={8}
          aria-labelledby={poolId}
          value={poolText}
          onChange={(e) => setAuto({ pool: linesToTags(e.target.value) })}
        />
        <div className="tagchips">
          {(auto().pool ?? []).slice(0, 40).map((t, i) => <span className="chip" key={i}>#{t}</span>)}
        </div>
        <p className="hint" style={{ marginTop: 10 }}>{(auto().pool ?? []).length} tags in pool.</p>
        <h3>Always-included manual tags (comma separated)</h3>
        <Txt label="manual hashtags" get={() => (r().hashtags ?? []).join(', ')} set={(v) => setR({ hashtags: linesToTags(v) })} />
      </div>
      <div className="grid-2">
        <div className="card">
          <h2>Text shape</h2>
          <Txt label="prepend (every post)" get={() => r().prepend} set={(v) => setR({ prepend: v })} />
          <Txt label="append (every post)" get={() => r().append} set={(v) => setR({ append: v })} />
          <div style={{ marginTop: 10 }}>
            <Check label="credit the source account (adds “Source @handle”)" get={() => r().creditSource !== false} set={(v) => setR({ creditSource: v })} />
          </div>
          <Txt label="credit wording" get={() => r().creditLabel ?? 'Source'} set={(v) => setR({ creditLabel: v })} hint="prefixed to the handle on LinkedIn reposts, e.g. “Source @iraj-janali”. Clear it for a bare @handle; untick above to drop the line entirely." />
          <h3>Cut original text at these markers</h3>
          <p className="hint">e.g. your ✍ signature line.</p>
          <Txt label="cut markers (comma separated)" get={() => (r().cutFromMarkers ?? []).join(', ')} set={(v) => setR({ cutFromMarkers: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
          <div style={{ marginTop: 10 }}>
            <Check label="collapse blank lines" get={() => r().collapseBlankLines !== false} set={(v) => setR({ collapseBlankLines: v })} />
          </div>
        </div>
        <div className="card">
          <h2>Style &amp; limits</h2>
          <Txt label="opening hook line (optional)" get={() => r().style?.hook} set={(v) => setStyle({ hook: v })} />
          <Txt label="closing CTA line (optional)" get={() => r().style?.cta} set={(v) => setStyle({ cta: v })} />
          <div className="grid-2" style={{ marginTop: 8 }}>
            <Num label="sentences / paragraph" get={() => r().style?.sentencesPerParagraph ?? 3} set={(v) => setStyle({ sentencesPerParagraph: v ?? 3 })} />
            <Num label="max characters" get={() => r().maxChars ?? 2900} set={(v) => setR({ maxChars: v ?? 2900 })} />
          </div>
          <p className="hint">Style fields are ignored for structured article posts (their layout is fixed by the template).</p>
        </div>
      </div>
    </div>
  );
}
