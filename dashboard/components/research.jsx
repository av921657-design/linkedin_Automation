'use client';

import { useMemo } from 'react';
import { Check, Num, Txt } from './controls';
import { linesToList } from '../lib/ui';

/** The day's post is researched from public feeds, then confirmed on Telegram. */
export function Research({ cfg, update }) {
  const rs = () => cfg.research ?? {};
  const setRs = (p) => update((d) => { d.research = { ...(d.research ?? {}), ...p }; });
  const setSub = (key, p) =>
    update((d) => { d.research = { ...(d.research ?? {}), [key]: { ...(d.research?.[key] ?? {}), ...p } }; });
  const setWeights = (p) =>
    update((d) => { d.research = { ...(d.research ?? {}), weights: { ...(d.research?.weights ?? {}), ...p } }; });

  const topicsText = useMemo(() => (rs().topics ?? []).join('\n'), [cfg]);
  const subsText = useMemo(() => (rs().reddit?.subreddits ?? []).join('\n'), [cfg]);
  const on = rs().enabled !== false;
  const hasTopics = (rs().topics ?? []).length > 0;

  return (
    <div className="panel">
      <div className="card">
        <h2>
          Where the day's post comes from{' '}
          <span className={`pill ${on ? (hasTopics ? 'on' : 'warn') : 'off'}`}>
            {on ? (hasTopics ? 'active' : 'no topics yet') : 'off'}
          </span>
        </h2>
        <p className="hint">
          Since profile browsing was banned, the content is looked up on the open web instead: Google News, Hacker News and Reddit.
          All three are public feeds read without an account, password or API key. This tab only decides <b>what gets found and
          shown to you</b> — nothing is published from here. The post is written and sent only after you reply <span className="mono">yes</span>
          {' '}or a number on Telegram (Telegram tab). Before a menu is built, junk is thrown away: a wrapper page whose title says
          nothing, an auto-generated &quot;X vs Y Live&quot; page that only repeats your own topic back, the same story carried by two
          feeds, and more than two items from one publisher.
        </p>
        <div style={{ marginBottom: 8 }}>
          <Check label="research the web" get={() => on} set={(v) => setRs({ enabled: v })} />
        </div>
        <h3>Topics it rotates through — one per line ({(rs().topics ?? []).length} saved)</h3>
        <textarea
          rows={6}
          value={topicsText}
          placeholder={'e.g.\nartificial intelligence at work\nstartup funding India\ncareer growth and hiring'}
          onChange={(e) => setRs({ topics: linesToList(e.target.value) })}
        />
        <p className="hint">
          Each day takes the next line, so a short list covers one subject a day and comes back round. With no topics at all the
          search falls back to today's front pages, which is a vaguer pick — keep this list filled.
        </p>
        <div className="grid-3" style={{ marginTop: 8 }}>
          <Num label="candidates on your menu" get={() => rs().candidates ?? 5} set={(v) => setRs({ candidates: v ?? 5 })} />
          <Num label="topic search reaches back (hours)" get={() => rs().topicWindowHours ?? 72} set={(v) => setRs({ topicWindowHours: v ?? 72 })} />
          <Num label="daily search reaches back (hours)" get={() => rs().dailyWindowHours ?? 24} set={(v) => setRs({ dailyWindowHours: v ?? 24 })} />
        </div>
      </div>

      <div className="card">
        <h2>Which feeds it reads</h2>
        <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
          <Check label="Google News — news about the topic, publisher named" get={() => rs().googleNews?.enabled !== false} set={(v) => setSub('googleNews', { enabled: v })} />
          <Check label="Hacker News — what tech is arguing about today" get={() => rs().hackerNews?.enabled !== false} set={(v) => setSub('hackerNews', { enabled: v })} />
          <Check label="Reddit — top posts of the day in the subreddits below" get={() => rs().reddit?.enabled !== false} set={(v) => setSub('reddit', { enabled: v })} />
        </div>
        <h3>Subreddits — one per line, no "r/" needed ({(rs().reddit?.subreddits ?? []).length} saved)</h3>
        <textarea
          rows={3}
          value={subsText}
          placeholder={'e.g.\nstartups\nEntrepreneur\nartificial'}
          onChange={(e) => setSub('reddit', { subreddits: linesToList(e.target.value) })}
        />
        <p className="hint">Each subreddit is one more web request per run, so a handful is plenty. NSFW and stickied posts are always skipped.</p>
        <h3>Google News region</h3>
        <div className="grid-3">
          <Txt label="language" mono get={() => rs().googleNews?.language ?? 'en'} set={(v) => setSub('googleNews', { language: v })} />
          <Txt label="region (locale)" mono get={() => rs().googleNews?.locale ?? 'IN'} set={(v) => setSub('googleNews', { locale: v })} />
          <Txt label="country" mono get={() => rs().googleNews?.country ?? 'IN'} set={(v) => setSub('googleNews', { country: v })} />
        </div>
        <p className="hint">Two-letter codes — "en" and "IN" give Indian English news. Wrong codes make Google return nothing, which looks like a quiet day rather than an error.</p>
      </div>

      <div className="card">
        <h2>How much of each article it reads</h2>
        <div style={{ marginBottom: 8 }}>
          <Check label="open the article and keep its opening paragraphs" get={() => rs().enrich !== false} set={(v) => setRs({ enrich: v })} />
        </div>
        <div className="grid-3">
          <Num label="results taken per feed" get={() => rs().maxPerSource ?? 12} set={(v) => setRs({ maxPerSource: v ?? 12 })} />
          <Num label="articles opened" get={() => rs().enrichMaxItems ?? 4} set={(v) => setRs({ enrichMaxItems: v ?? 4 })} />
          <Num label="characters kept per article" get={() => rs().enrichMaxBodyChars ?? 6000} set={(v) => setRs({ enrichMaxBodyChars: v ?? 6000 })} />
        </div>
        <p className="hint">
          With the switch on, the rewrite summarises a real article with a link and credit. With it off the post is built from the
          headline and snippet only — shorter, thinner.
        </p>
        <h3>Scoring weights (0–1)</h3>
        <div className="grid-3">
          <Num label="topic match" step={0.05} get={() => rs().weights?.relevance ?? 0.55} set={(v) => setWeights({ relevance: v ?? 0.55 })} />
          <Num label="trending" step={0.05} get={() => rs().weights?.trending ?? 0.3} set={(v) => setWeights({ trending: v ?? 0.3 })} />
          <Num label="recency" step={0.05} get={() => rs().weights?.recency ?? 0.15} set={(v) => setWeights({ recency: v ?? 0.15 })} />
        </div>
        <p className="hint">
          A floor on topic match stays in force whatever you set, so an unrelated viral post can never be pushed onto your profile.
          Already-published stories are dropped before the menu is built, so a duplicate can't even reach you.
        </p>
      </div>

      <div className="card">
        <h2>Before it goes live</h2>
        <p className="hint">
          Nothing here needs a key or a login. What it does need is a channel to ask you on: the Telegram tab must be switched on
          with your chat id, because a yes is now mandatory. Until then the machine researches and waits, and the only content that
          can post is a folder you drop in <span className="mono">queue/</span> yourself.
        </p>
      </div>
    </div>
  );
}
