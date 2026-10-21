'use client';

import { useMemo, useState } from 'react';
import flows from '../lib/flows.json';

/**
 * The Practical AI Use Cases Repository — every flow the newsletter draws from,
 * read straight out of `dashboard/lib/flows.json`, which `npm run flows:export`
 * generates from the same src/usecases.js library the post, the infographic and
 * the public site use. This tab is a window, not an editor: a flow is added by
 * writing it in src/flows*.js, never by typing it into a browser.
 *
 * Field tabs carry the count of flows that field actually holds, so a tab that
 * says "Supply chain 3" opens to three flows and no more.
 */

const STEP_LABEL = { ask: 'you type', check: 'you check', do: 'it does' };

function FlowCard({ flow, open, onToggle }) {
  const steps = flow.steps ?? [];
  return (
    <article className="card flowcard" style={{ '--accent': flow.accent }}>
      <button type="button" className="flowhead" onClick={onToggle} aria-expanded={open}>
        <span className="flowtitle">{flow.title}</span>
        <span className="flowjob">{flow.job}</span>
        <span className="flowarrow">{flow.arrow}</span>
        <span className="flowmeta">
          <span className="pill">{flow.fieldLabel}</span>
          <span className="pill">{flow.minutes} min</span>
          <span className="pill">{flow.costLabel}</span>
          <span className="flowchev">{open ? 'less' : 'the steps'}</span>
        </span>
      </button>
      {open && (
        <div className="flowbody">
          {flow.situation && (
            <p className="serif-note">
              {flow.situation}
            </p>
          )}
          <h3>The chain, step by step</h3>
          <ol className="flowsteps">
            {steps.map((s, i) => (
              <li key={i} className={`step step-${s.type}`}>
                <span className="stepno">{i + 1}</span>
                <span className="stepmain">
                  <span className="steptool">
                    {s.tool}
                    {s.chip ? <span className="stepchip">{s.chip}</span> : null}
                    <span className="steptype">{STEP_LABEL[s.type] ?? 'step'}</span>
                  </span>
                  <span className="stepdo">{s.do}</span>
                </span>
              </li>
            ))}
          </ol>
          {flow.prompt && (
            <>
              <h3>Copy this prompt</h3>
              <p className="promptbox">{flow.prompt}</p>
            </>
          )}
          <h3>What you end up with</h3>
          <p className="flowout">{flow.outcome}</p>
          {flow.guard && <p className="hint">Careful: {flow.guard}</p>}
          {flow.payers?.length > 0 && <p className="hint">Paid or account-gated tools in this chain: {flow.payers.join(', ')}.</p>}
          <p className="hint">Who it is for: {flow.who}</p>
        </div>
      )}
    </article>
  );
}

export function Repository() {
  const [field, setField] = useState('all');
  const [q, setQ] = useState('');
  const [openSlug, setOpenSlug] = useState(null);

  const counts = useMemo(() => {
    const m = new Map();
    for (const f of flows.flows) m.set(f.field, (m.get(f.field) ?? 0) + 1);
    return m;
  }, []);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return flows.flows
      .filter((f) => field === 'all' || f.field === field)
      .filter((f) => !needle || `${f.title} ${f.job} ${f.situation} ${f.outcome} ${f.arrow} ${f.prompt}`.toLowerCase().includes(needle))
      .sort((a, b) => (a.fieldLabel === b.fieldLabel ? a.title.localeCompare(b.title) : a.fieldLabel.localeCompare(b.fieldLabel)));
  }, [field, q]);

  const tabs = [{ id: 'all', label: 'All fields', count: flows.total }, ...flows.fields];

  return (
    <>
      <section className="card">
        <h2>Practical AI Use Cases Repository</h2>
        <p className="hint">
          {flows.total} step-by-step flows across {flows.fields.length} professional fields — the library the newsletter
          picks five from, twice a day. Each one says what to open, in what order, what to type, and what you hold at
          the end. Written in <code>src/flows*.js</code>; this page reads the same list, so it cannot disagree with a post.
        </p>
        <p className="repstamp">
          Generated {new Date(flows.generatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ·{' '}
          {flows.cost}
        </p>

        <div className="repsearch">
          <input
            className="repinput"
            type="search"
            placeholder="Search a flow: invoice, ATS, sheet, lesson…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search the use-case repository"
          />
        </div>

        <div className="repchips" role="tablist" aria-label="Fields">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={field === t.id}
              className={`repchip${field === t.id ? ' active' : ''}`}
              style={{ '--accent': t.accent ?? 'var(--amber)' }}
              onClick={() => setField(t.id)}
            >
              {t.label}
              <span className="repcount">{counts.get(t.id) ?? t.count ?? 0}</span>
            </button>
          ))}
        </div>

        <p className="hint reptally">
          {list.length} flow{list.length === 1 ? '' : 's'} shown{field === 'all' ? '' : ` in ${tabs.find((t) => t.id === field)?.label}`}.
          Open one to see its steps.
        </p>
        {list.length === 0 && <p className="err">Nothing matches that search in this field. Clear the box, or pick another tab.</p>}
      </section>

      {list.map((f) => (
        <FlowCard
          key={f.slug}
          flow={f}
          open={openSlug === f.slug}
          onToggle={() => setOpenSlug(openSlug === f.slug ? null : f.slug)}
        />
      ))}
    </>
  );
}
