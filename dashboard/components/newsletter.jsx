'use client';

import { useMemo, useState } from 'react';
import { Check, Num, Select, Txt } from './controls';
import { NL_LABEL, NL_PILL, WEEKDAYS, cadenceWords, dayRange, eventsOf, linesToList, newsletterNote, stamp } from '../lib/ui';

const DAY_SHORT = [['Sun', 'Su'], ['Mon', 'Mo'], ['Tue', 'Tu'], ['Wed', 'We'], ['Thu', 'Th'], ['Fri', 'Fr'], ['Sat', 'Sa']];
const STYLES = [['practical', 'DIY use cases — what to do next'], ['release', 'Release notes — version by version']];
const COSTS = [
  ['free', 'nothing at all, not even an account'],
  ['signup', 'or a free account'],
  ['free-tier', 'or a free tier with limits'],
  ['paid', 'anything, including paid plans'],
];

/**
 * The AI newsletter. Everything here decides what an issue is *made of*
 * and when it is offered to you — the publishing decision itself is only ever
 * made by your `/nl yes` on Telegram, and this tab cannot override it.
 */
export function Newsletter({ cfg, update, status, tz }) {
  const nl = () => cfg.newsletter ?? {};
  const setNl = (patch) => update((d) => { d.newsletter = { ...(d.newsletter ?? {}), ...patch }; });
  const setSub = (key, patch) =>
    update((d) => { d.newsletter = { ...(d.newsletter ?? {}), [key]: { ...(d.newsletter?.[key] ?? {}), ...patch } }; });

  const topicsText = useMemo(() => (nl().topics ?? []).join('\n'), [cfg]);
  const tagsText = useMemo(() => (nl().extraHashtags ?? []).join('\n'), [cfg]);
  const notesText = useMemo(() => (nl().feedback ?? []).join('\n'), [cfg]);
  const lines = useMemo(() => Object.entries(nl().useCaseLines ?? {}), [cfg]);
  // Rows are keyed by name, so typing in one row must not re-key the others.
  const [draftRow, setDraftRow] = useState({ name: '', text: '' });

  const on = nl().enabled !== false;
  const hasTopics = (nl().topics ?? []).length > 0;
  const tgOn = cfg.telegram?.enabled === true && (cfg.telegram?.allowedChatIds ?? []).length > 0;
  // The same calendar the runner reads, so this tab never shows a cadence that is
  // not the one actually in force.
  const events = useMemo(() => eventsOf(nl()), [cfg]);
  const cadence = useMemo(() => cadenceWords(nl()), [cfg]);
  // Written back as one list: the editor always saves normalised rows, so the
  // config on disk and the machine's calendar can never disagree.
  const saveEvents = (next) => setNl({ events: next.map((e) => ({ ...e, days: WEEKDAYS.filter((d) => e.days.includes(d)) })) });
  const patchEvent = (i, patch) => saveEvents(events.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  const toggleDay = (i, d) => {
    const e = events[i];
    const days = e.days.includes(d) ? e.days.filter((x) => x !== d) : [...e.days, d];
    if (!days.length) return; // an issue with no day would silently vanish
    patchEvent(i, { days });
  };
  const addEvent = () => {
    // A second issue the same day: the next whole hour after the last row.
    const last = events.at(-1);
    const hour = Math.min(23, (last?.hour ?? 8) + 9);
    saveEvents([...events, { name: `Issue ${events.length + 1}`, days: [...WEEKDAYS], hour, on: true }]);
  };
  const dropEvent = (i) => saveEvents(events.filter((_, k) => k !== i));

  const setLine = (oldName, newName, text) => setNl({
    useCaseLines: Object.fromEntries(
      lines.map(([k, v]) => (k === oldName ? [newName, text] : [k, v])),
    ),
  });
  const dropLine = (name) => setNl({
    useCaseLines: Object.fromEntries(lines.filter(([k]) => k !== name)),
  });
  const addLine = () => {
    const name = draftRow.name.trim();
    const text = draftRow.text.trim();
    if (!name || !text) return;
    setNl({ useCaseLines: { ...(nl().useCaseLines ?? {}), [name]: text } });
    setDraftRow({ name: '', text: '' });
  };

  return (
    <div className="panel">
      <div className="card">
        <h2>
          The AI newsletter, {cadence}{' '}
          <span className={`pill ${on ? (tgOn ? (hasTopics ? 'on' : 'warn') : 'warn') : 'off'}`}>
            {on ? (tgOn ? (hasTopics ? `asks you ${cadence}` : 'no searches yet') : 'waiting for Telegram') : 'off'}
          </span>
        </h2>
        <p className="hint">
          One issue {cadence === 'no set day' ? 'is not on the calendar' : cadence}, built from the public tech feeds —
          never from LinkedIn pages. It answers the question the whole thing exists for:{' '}
          <b>what can I actually do with this, and what has AI solved for me?</b> {nl().useCaseCount ?? 5} DIY flows, each written out
          in full — the field it came from, the situation, the arrows, the words to type, what it costs and what you end up with — plus
          the short version ladder underneath them. Every version it has ever announced is remembered in{' '}
          <span className="mono">state/newsletter-versions.json</span>, so an old release never comes back dressed up as news. Each
          issue is filed in <span className="mono">newsletter-issues/</span> — the text, the infographic and a readable copy — so the
          archive grows even on a day nothing publishes.
        </p>
        {status?.newsletter && (
          <p className="hint" style={{ fontSize: 13 }}>
            <span className={`pill ${NL_PILL[status.newsletter.waiting] || ''}`}>
              {NL_LABEL[status.newsletter.waiting] || (status.newsletter.enabled === false ? 'switched off' : 'this issue')}
            </span>{' '}
            {newsletterNote(status.newsletter)}
            {status.at && <> Last reported by the Mac: <span className="mono">{stamp(status.at, tz)}</span> ({tz}).</>}
          </p>
        )}
        <div style={{ marginBottom: 8 }}>
          <Check label="write a newsletter" get={() => on} set={(v) => setNl({ enabled: v })} />
        </div>
        <Txt label="issue name" get={() => nl().name ?? 'The AI Week'} set={(v) => setNl({ name: v })} />
        <div style={{ marginTop: 8 }}>
          <Num label="how far back each issue looks (hours)" get={() => nl().windowHours ?? 24} set={(v) => setNl({ windowHours: v ?? 24 })} hint="keep it near the gap between two rows below — 24 is one day" />
        </div>
        <div className="grid-3" style={{ marginTop: 8 }}>
          <Num label="sections per issue" get={() => nl().sections ?? 4} set={(v) => setNl({ sections: v ?? 4 })} />
          <Num label="changes per section" get={() => nl().itemsPerSection ?? 3} set={(v) => setNl({ itemsPerSection: v ?? 3 })} />
        </div>
        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
          <Check label="draw the version ladder (4.5 → 5 → 5.1)" get={() => nl().versionLadder !== false} set={(v) => setNl({ versionLadder: v })} />
          <Check label="attach the infographic image to the LinkedIn post" get={() => nl().attachInfographic !== false} set={(v) => setNl({ attachInfographic: v })} />
          <Check label="shorter, plainer sentences (trims jargon out of the lead line)" get={() => nl().plainLanguage === true} set={(v) => setNl({ plainLanguage: v })} />
        </div>
      </div>

      <div className="card">
        <h2>Your calendar — every row is one issue</h2>
        <p className="hint">
          Daily events and weekly events are the same list: a row says which weekdays it runs on and at what hour it lands there.
          Twice a day is two rows on all seven days — what you have now. Tick a day off to make a row weekly instead, add a row for a
          third issue, or switch one off without deleting it. Nothing here publishes anything: each row only decides when the issue is
          researched and asked about on Telegram. Hours are wall-clock in <span className="mono">{tz}</span>.
        </p>
        {events.map((e, i) => (
          <div key={`${e.name}-${i}`} className="eventrow">
            <div className="eventrow-head">
              <Txt label="name of this issue" get={() => e.name} set={(v) => patchEvent(i, { name: v })} />
              <Num label="hour it lands" get={() => e.hour} set={(v) => patchEvent(i, { hour: Math.min(23, Math.max(0, Math.round(v))) })} hint={`0–23, ${tz}`} />
              <Check label="on" get={() => e.on} set={(v) => patchEvent(i, { on: v })} />
              <button className="linkbtn" type="button" onClick={() => dropEvent(i)} disabled={events.length <= 1}>remove</button>
            </div>
            <div className="days" style={{ marginTop: 6 }}>
              {DAY_SHORT.map(([d, short]) => (
                <button
                  key={d}
                  type="button"
                  className={`hourbtn${e.days.includes(d) ? ' on' : ''}`}
                  onClick={() => toggleDay(i, d)}
                  title={WEEKDAYS.find((w) => w === d)}
                  aria-pressed={e.days.includes(d)}
                >
                  {short}
                </button>
              ))}
              <button className="preset" type="button" onClick={() => patchEvent(i, { days: [...WEEKDAYS] })}>every day</button>
              <button className="preset" type="button" onClick={() => patchEvent(i, { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] })}>weekdays</button>
              <span className="hint" style={{ alignSelf: 'center' }}>{dayRange(e.days)} at {String(e.hour).padStart(2, '0')}:00</span>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="preset" type="button" onClick={addEvent} disabled={events.length >= 6}>add another issue</button>
          <span className="hint">{events.filter((e) => e.on).length} of {events.length} row(s) on · {cadence}</span>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          The day&apos;s posts are capped by <span className="mono">post.maxPerDay</span> on the Limits tab. Today it is{' '}
          {cfg.post?.maxPerDay ?? 1}, so if the calendar asks for more issues than that, the extra one waits for a slot — a duplicate
          is worse than a missing post, and nothing is ever published you did not answer yes to.
        </p>
      </div>

      <div className="card">
        <h2>Practical AI use cases — the half readers act on</h2>
        <p className="hint">
          A <b>DIY use cases</b> issue leads with flows you can run the same day: each one names
          the <b>field</b> it was reported from — supply chain, warehousing, HR, teaching, IT and fourteen more — the situation it fits,
          the <span className="mono">tool → tool → tool</span> chain, the exact words to type, and what you end up with. What actually
          moved stays underneath as a short strip, so the news is still there — it just no longer arrives without the doing.
          Choose <b>Release notes</b> to get the original release-first shape back.
        </p>
        <div className="grid-3">
          <Select label="issue style" get={() => nl().style ?? 'practical'} set={(v) => setNl({ style: v })} options={STYLES} />
          <Num label="flows per issue" get={() => nl().useCaseCount ?? 5} set={(v) => setNl({ useCaseCount: v ?? 5 })} hint="0–12; five detailed ones, five different fields" />
          <Select label="most a flow may cost" get={() => nl().maxCost ?? 'free-tier'} set={(v) => setNl({ maxCost: v })} options={COSTS} />
        </div>
        <p className="hint">
          The cost badge is computed from a flow&apos;s own steps, never typed by hand: if one step needs a card in your wallet, the
          whole flow is outside the ceiling and never appears. A tool the registry has not heard of is refused rather than assumed
          free, so the promise holds.
        </p>

        <h3>The web page the post points at</h3>
        <div className="grid-3">
          <Txt label="repository name" get={() => nl().site?.name ?? 'Practical AI Use Cases Repository'} set={(v) => setSub('site', { name: v })} />
          <Txt label="public address (empty means no links)" mono get={() => nl().site?.baseUrl ?? ''} set={(v) => setSub('site', { baseUrl: v })} placeholder="https://your-name.example.app" hint="https:// and nothing after it" />
          <Txt label="folder it is written to" mono get={() => nl().site?.outDir ?? 'site'} set={(v) => setSub('site', { outDir: v })} />
        </div>
        <p className="hint">
          The pages are drawn from the same data as the post and the infographic, so a flow can never read differently in two places,
          and the folder keeps every flow ever published — a library, not a weekly link.{' '}
          <b>While the address is empty the post carries no link at all</b>, because a link that does not open costs more trust than a
          missing one. Fill it in only once that folder is somewhere readers can reach, then{' '}
          <span className="mono">npm run newsletter:site</span> rebuilds it with the links live.
        </p>

        <h3>Where a yes sends it</h3>
        <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
          <Check label="LinkedIn — your own profile, through the composer" get={() => nl().channels?.linkedin !== false} set={(v) => setSub('channels', { linkedin: v })} />
          <Check label="Reddit as well" get={() => nl().channels?.reddit === true} set={(v) => setSub('channels', { reddit: v })} />
        </div>
        <Txt label="subreddit, without the r/" mono get={() => nl().redditSubreddit ?? ''} set={(v) => setNl({ redditSubreddit: v })} placeholder="e.g. artificial" />
        <p className="hint">
          Reddit is API-only — no browser, no logged-in page, nothing posted by clicking. It needs a free script app of your own, and
          its credentials live in <span className="mono">state/reddit.json</span>, never in this config, because this file syncs to the
          cloud. Set it up by double-clicking <span className="mono">windows\reddit-setup.bat</span>. Until that is done, switching
          Reddit on here is refused rather than half-saved. On Telegram you can still redirect one issue without touching this tab:{' '}
          <span className="mono">/nl linkedin</span>, <span className="mono">/nl reddit r/name</span>, <span className="mono">/nl both</span>,{' '}
          <span className="mono">/nl where</span>.
        </p>
      </div>

      <div className="card">
        <h2>Your feedback — the box that changes the next issue</h2>
        <p className="hint">
          Write what was boring, unclear, too long, or missing. One note per line, in ordinary sentences. The next issue is built
          with them: <span className="mono">shorter</span>, <span className="mono">more use cases</span>,{' '}
          <span className="mono">simpler words</span>, <span className="mono">no version ladder</span>,{' '}
          <span className="mono">stop covering crypto</span> and <span className="mono">more about robots</span> are all understood
          without you touching a setting. Keep a line in the box and it keeps shaping issues until you remove it — notes are marked
          used once, so the same sentence never applies twice, and anything already sent with Telegram <span className="mono">/feedback</span> is
          not repeated. Each issue lists the notes it was built from, so you can see whether it worked.
        </p>
        <textarea
          rows={5}
          value={notesText}
          placeholder={'e.g.\nshorter post\nmore use cases\nstop covering crypto\nmore about AI agents'}
          onChange={(e) => setNl({ feedback: linesToList(e.target.value) })}
        />
        <p className="hint">
          Prefer your phone? Message the bot <span className="mono">/feedback shorter</span> — it lands in the same note store.{' '}
          <b>{(nl().feedback ?? []).length} note(s) in the box.</b>
        </p>
      </div>

      <div className="card">
        <h2>What it searches for</h2>
        <h3>Search phrases — one per line ({(nl().topics ?? []).length} saved)</h3>
        <textarea
          rows={8}
          value={topicsText}
          placeholder={'e.g.\nOpenAI ChatGPT new model\nAnthropic Claude release\nAI coding agent release'}
          onChange={(e) => setNl({ topics: linesToList(e.target.value) })}
        />
        <p className="hint">
          These are phrased for news desks, not for a search box — they have to return <i>release announcements</i>, which is what a
          version ladder is built from. This list is the newsletter&apos;s own; the daily post uses the (different) topics on the{' '}
          <b>Web research</b> tab. An empty box falls back to the built-in AI release searches, and the day&apos;s front pages are
          always scanned too, so a story nobody thought to ask about still arrives.
        </p>
        <h3>Your own use-case line for a tool — optional</h3>
        <p className="hint">
          The newsletter only ever states what a real person can do if an article says it. If you know better what a tool is good
          for, write the line here and it is used instead, labelled as yours.
        </p>
        {lines.length === 0 && <p className="hint" style={{ fontStyle: 'italic' }}>None yet.</p>}
        {lines.map(([name, text]) => (
          <div key={name} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8, alignItems: 'end', marginBottom: 8 }}>
            <Txt label="tool or theme" mono get={() => name} set={(v) => setLine(name, v || name, text)} />
            <Txt label="the line readers see" get={() => text} set={(v) => setLine(name, name, v)} />
            <button className="linkbtn" type="button" onClick={() => dropLine(name)}>remove</button>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8, alignItems: 'end' }}>
          <div className="field">
            <label>new tool or theme</label>
            <input type="text" className="mono" value={draftRow.name} placeholder="e.g. OpenAI GPT" onChange={(e) => setDraftRow((d) => ({ ...d, name: e.target.value }))} />
          </div>
          <div className="field">
            <label>new line</label>
            <input type="text" value={draftRow.text} placeholder="e.g. You can hand it your spreadsheet and ask for the three numbers that changed" onChange={(e) => setDraftRow((d) => ({ ...d, text: e.target.value }))} />
          </div>
          <button className="linkbtn" type="button" onClick={addLine}>add</button>
        </div>
      </div>

      <div className="card">
        <h2>How much of it goes on your page</h2>
        <div className="grid-3">
          <Num label="use-case lines per issue" get={() => nl().useCases ?? 1} set={(v) => setNl({ useCases: v ?? 1 })} />
          <Num label="post length cap (characters)" get={() => nl().maxPostChars ?? 2400} set={(v) => setNl({ maxPostChars: v ?? 2400 })} />
          <Num label="hashtags" get={() => nl().hashtagCount ?? 8} set={(v) => setNl({ hashtagCount: v ?? 8 })} />
        </div>
        <h3>Tags always added after the issue&apos;s own — one per line</h3>
        <textarea rows={2} value={tagsText} placeholder={'e.g.\nAI\nArtificialIntelligence'} onChange={(e) => setNl({ extraHashtags: linesToList(e.target.value) })} />
        <p className="hint">
          The tags an issue carries come from what it is actually about — the tool families it tracked. This list only tops that up;
          a generic business tag on an AI release note is how a post reads as automated.
        </p>
        <Txt label="line at the end of every issue (empty for the default)" get={() => nl().footer ?? ''} set={(v) => setNl({ footer: v })} />
      </div>

      <div className="card">
        <h2>Waiting for your yes</h2>
        <p className="hint">
          Nothing publishes without <span className="mono">/nl yes</span> on Telegram. These three numbers are only how long the bot
          is patient about it — they never post on their own.
        </p>
        <div className="grid-3">
          <Num label="hours your yes is waited for" step={0.5} get={() => nl().approval?.answerHours ?? 24} set={(v) => setSub('approval', { answerHours: v ?? 24 })} />
          <Num label="nudge after (hours)" step={0.25} get={() => nl().approval?.remindAfterHours ?? 6} set={(v) => setSub('approval', { remindAfterHours: v ?? 6 })} />
          <Num label="days an unanswered issue is re-offered" get={() => nl().approval?.holdDays ?? 3} set={(v) => setSub('approval', { holdDays: v ?? 3 })} />
        </div>
        <p className="hint">
          No answer at all and the issue is dropped, never posted — a fresh one is researched at the next row on your calendar.{' '}
          {cfg.telegram?.enabled === true
            ? <span className="pill ok">Telegram is on</span>
            : <span className="pill warn">Telegram is off — with it off, an issue can be drafted but never approved, so nothing publishes. Set it up on the Telegram tab.</span>}
        </p>
      </div>

      <div className="card">
        <h2>The infographic</h2>
        <p className="hint">
          Drawn by code — the issue&apos;s own text laid out as a card and photographed by a hidden browser window. No design tool, no
          paid image service, nothing sent anywhere. It is generated when the issue is drafted, so the PNG is already on your
          Telegram offer.
        </p>
        <div className="grid-3">
          <Num label="width (px)" get={() => nl().infographic?.width ?? 1080} set={(v) => setSub('infographic', { width: v ?? 1080 })} />
          <Num label="height (px)" get={() => nl().infographic?.height ?? 1350} set={(v) => setSub('infographic', { height: v ?? 1350 })} />
          <Num label="sharpness (×)" get={() => nl().infographic?.scale ?? 2} set={(v) => setSub('infographic', { scale: v ?? 2 })} />
          <Txt label="accent colour" mono get={() => nl().infographic?.accent ?? '#4f46e5'} set={(v) => setSub('infographic', { accent: v })} hint="hex, e.g. #4f46e5" />
        </div>
        <p className="hint">1080×1350 is LinkedIn&apos;s 4:5 portrait — the shape that fills the most screen in the feed.</p>
      </div>

      <div className="card">
        <h2>Every issue ever filed</h2>
        <p className="hint">
          The list lives on the Mac, in <span className="mono">newsletter-issues/</span>; the dashboard only ever sees the last tick.
          Each folder holds <span className="mono">post.txt</span> (what went up), <span className="mono">issue.md</span> (the
          readable full issue), <span className="mono">infographic.png</span> and <span className="mono">issue.json</span> (the data
          an issue was built from, including which of your notes it used) — the raw material for a paid edition later.
        </p>
        {status?.at && (
          <p className="hint" style={{ fontSize: 13 }}>
            Last reported by the Mac: <span className="mono">{stamp(status.at, tz)}</span> ({tz}).
          </p>
        )}
      </div>
    </div>
  );
}
