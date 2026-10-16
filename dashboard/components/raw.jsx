'use client';

import { useEffect, useState } from 'react';

export function Raw({ cfg, update }) {
  const [text, setText] = useState(() => JSON.stringify(cfg ?? {}, null, 2));
  const [err, setErr] = useState('');
  useEffect(() => { if (cfg) setText(JSON.stringify(cfg, null, 2)); }, [cfg]);
  return (
    <div className="card panel">
      <h2>Raw config.json</h2>
      <p className="hint">Full file, including per-source <span className="mono">reformat</span> overrides and any field the forms don't show. “Apply to editor” pushes it into the forms; Save uploads it.</p>
      <textarea rows={24} aria-label="Raw config JSON" value={text} onChange={(e) => setText(e.target.value)} />
      {err && <div className="err">{err}</div>}
      <div style={{ marginTop: 10 }}>
        <button className="ghost" onClick={() => {
          try {
            const parsed = JSON.parse(text);
            setErr('');
            update(() => parsed);
          } catch (e) {
            setErr(`Invalid JSON: ${e.message}`);
          }
        }}>Apply to editor</button>
      </div>
    </div>
  );
}
