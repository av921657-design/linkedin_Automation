'use client';

import { useEffect, useState } from 'react';
import {
  zonedFrac, zonedParts, stamp, nextSlot, normalizeSchedule, slotsForDate, unionSlots, isWeekend, tzLabel,
} from '../lib/ui';

/**
 * Live clock + countdown to the next scheduled run, both in the schedule's
 * timezone and evaluated DAY-WISE: today's slots drive "inside a window", and
 * when today is spent it rolls into the next day that has any (label says
 * "10:00 tomorrow").
 */
export function useNextRun(cfg) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => (x + 1) % 1000), 1000);
    return () => clearInterval(t);
  }, []);
  const { tz, weekday, weekend } = normalizeSchedule(cfg);
  const now = zonedParts(new Date(), tz);
  const today = slotsForDate(cfg, new Date());
  const cur = now.h + now.m / 60 + now.s / 3600;
  const ns = nextSlot(cfg, new Date());
  const secs = ns ? Math.max(0, Math.round(ns.hoursFromNow * 3600)) : null;
  const h = Math.floor((secs ?? 0) / 3600), m = Math.floor(((secs ?? 0) % 3600) / 60);
  return {
    active: today.includes(now.h),
    group: isWeekend(new Date(), tz) ? 'weekend' : 'weekday',
    tz, tzLabel: tzLabel(tz),
    today, weekday, weekend,
    hNow: now.h, mNow: now.m, sNow: now.s,
    text: secs === null ? null : (secs < 60 ? '< 1 min' : h >= 1 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`),
    atLabel: ns ? ns.label : null,
    clock: `${String(now.h).padStart(2, '0')}:${String(now.m).padStart(2, '0')}:${String(now.s).padStart(2, '0')}`,
    _cur: cur,
  };
}

/**
 * 24-hour rail in the schedule's timezone. Today's slots render solid (amber);
 * the other day-group's extra slots render faint so the weekday/weekend
 * difference is visible. The work band spans the union of every hour used on
 * any day.
 */
export function DayRail({ cfg, history, now, countdown }) {
  const W = 660, H = 120, padX = 12, bandY = 18, bandH = 40;
  const inner = W - padX * 2;
  const X = (h) => padX + (h / 24) * inner;

  const zone = countdown.tz;
  const today = countdown.today || [];
  const alt = (countdown.group === 'weekend' ? countdown.weekday : countdown.weekend || []).filter((h) => !today.includes(h));
  const union = unionSlots(cfg);
  const winStart = union.length ? Math.max(0, Math.min(...union)) : 10;
  const winEnd = union.length ? Math.min(24, Math.max(...union) + 1) : 20;
  const ticks = [0, 4, 8, 12, 16, 20, 24];
  const dots = history.slice(0, 8).map((r) => {
    const f = zonedFrac(r.at, zone);
    if (f === null) return null;
    return {
      x: X(f),
      cls: r.dryRun ? 'res-dry' : `res-${r.result}`,
      title: `${stamp(r.at, zone)} ${countdown.tzLabel} · ${r.dryRun ? 'dry-run' : r.result}${r.candidate ? ' · ' + r.candidate : ''}`,
    };
  }).filter(Boolean);

  const cur = now.h + now.m / 60 + now.s / 3600;
  const nx = X(Math.min(23.98, Math.max(0.02, cur)));
  const label = `${countdown.group} — ${today.length ? today.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ') : 'no runs'}`;

  return (
    <div>
      <svg className="rail" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`24-hour schedule in ${countdown.tzLabel} time. Today (${label}). Runs at ${today.map((h) => `${h}:00`).join(', ') || 'no hours set'}. Now ${countdown.clock}.`}>
        <rect className="rail-bg" x="0.5" y="0.5" width={W - 1} height={H - 1} rx="12" />
        <rect className="band-night" x={padX} y={bandY} width={inner} height={bandH} rx="8" />
        <rect className="band-work" x={X(winStart)} y={bandY} width={X(winEnd) - X(winStart)} height={bandH} rx="8" />
        {ticks.map((t) => (
          <g key={t}>
            <line className="tick" x1={X(t)} y1={bandY + bandH} x2={X(t)} y2={bandY + bandH + 6} />
            <text className="tick-lbl" x={X(t)} y={bandY + bandH + 18} textAnchor={t === 0 ? 'start' : t === 24 ? 'end' : 'middle'}>
              {String(t % 24).padStart(2, '0')}
            </text>
          </g>
        ))}
        {alt.map((h) => (
          <circle key={`alt${h}`} className="win-alt" cx={X(h + 0.5)} cy={bandY + bandH / 2} r="3">
            <title>{`${String(h).padStart(2, '0')}:00 — other day-group`}</title>
          </circle>
        ))}
        {today.map((h) => (
          <circle key={h} className={`win ${countdown.active && h === Math.floor(cur) ? '' : 'dim'}`} cx={X(h + 0.5)} cy={bandY + bandH / 2} r="4" />
        ))}
        {dots.map((d, i) => (
          <g key={i}>
            <circle className={d.cls} cx={d.x} cy={84} r="3.5">
              <title>{d.title}</title>
            </circle>
          </g>
        ))}
        <text className="tick-lbl" x={padX} y={100}>{`recent runs — today, in ${countdown.tzLabel} time`}</text>
        <line className="now-line" x1={nx} y1={8} x2={nx} y2={92} />
        <circle className="now-glow" cx={nx} cy={bandY + bandH / 2} r="9" />
        <circle className="now-dot" cx={nx} cy={bandY + bandH / 2} r="3" />
        <text className="now-lbl" x={Math.min(W - 34, Math.max(14, nx))} y={14} textAnchor={nx > W - 60 ? 'end' : 'start'}>{countdown.clock}</text>
      </svg>
      <div className="rail-legend">
        <span><span className="sw" style={{ background: 'var(--amber)' }} />{label}</span>
        {alt.length > 0 && <span><span className="sw alt" />the other day&apos;s hours</span>}
        <span><span className="sw" style={{ background: 'var(--night)' }} />night — machine sleeps</span>
        <span><span className="sw" style={{ background: 'var(--text)', borderRadius: 8 }} />now</span>
      </div>
    </div>
  );
}
