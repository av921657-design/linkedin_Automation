'use client';

import { useState } from 'react';
import { Check, Txt, Num } from './controls';
import { TYPE_LABEL } from '../lib/ui';

export function Sources({ cfg, update }) {
  const sources = cfg.sources ?? [];
  return (
    <div className="card panel">
      <h2>Sources <span className="pill">{sources.length}</span></h2>
      <p className="hint">Disabled sources are skipped entirely. URL changes apply on the next run. Per-source <span className="mono">reformat</span> overrides live in the Raw JSON tab.</p>
      {sources.map((s, i) => {
        const urlKey = s.type === 'folder' ? 'path' : s.profileUrl !== undefined ? 'profileUrl' : 'url';
        return (
          <div className="rowsrc" key={i}>
            <div className="rowsrc-head">
              <div>
                <span className="mono srclabel">{TYPE_LABEL[s.type] || s.type}</span>
                <div style={{ marginTop: 3 }}>
                  <Check label="enabled" get={() => s.enabled !== false} set={(v) => update((d) => { d.sources[i].enabled = v; })} />
                </div>
              </div>
              <button className="danger" onClick={() => update((d) => { d.sources.splice(i, 1); })}>Remove</button>
            </div>
            <div className="row-fields">
              <Txt label={urlKey} mono get={() => s[urlKey]} set={(v) => update((d) => { d.sources[i][urlKey] = v; })} />
              {s.type === 'folder' ? <div /> : (
                <Num label="max/run" get={() => s.maxPostsPerRun ?? 10} set={(v) => update((d) => { d.sources[i].maxPostsPerRun = v ?? 10; })} />
              )}
              {s.type === 'article' && (
                <Txt label="linkPattern (optional)" mono get={() => s.linkPattern} set={(v) => update((d) => { d.sources[i].linkPattern = v || undefined; })} />
              )}
            </div>
          </div>
        );
      })}
      <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
        <AddSource update={update} />
      </div>
    </div>
  );
}

function AddSource({ update }) {
  const [type, setType] = useState('substack');
  return (
    <>
      <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 170 }} aria-label="Source type">
        {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <button className="ghost" onClick={() => update((d) => {
        d.sources = d.sources || [];
        d.sources.push(type === 'folder'
          ? { type: 'folder', path: 'queue', enabled: false }
          : { type, [type === 'linkedin' ? 'profileUrl' : 'url']: 'https://', maxPostsPerRun: 10, enabled: false });
      })}>+ Add source</button>
    </>
  );
}
