/**
 * Layer 3 — Statistical Intelligence
 *
 * Market regime classification (trending/ranging x high-vol/low-vol) from
 * real ADX/ATR data, plus a real win-rate-by-regime/day/time tracker built
 * entirely on this app's own trade history (PaperTrade.tags + entryDate).
 *
 * Honest limitation: this starts genuinely empty and only becomes useful
 * after real trades accumulate — there is no way to backfill years of
 * regime-conditioned history, since past trades were never tagged with the
 * regime they were entered in. It begins learning from today's real paper
 * trades onward (see options-scanner.ts, which now stamps each signal with
 * its regime, and route.ts, which persists that tag on the created trade).
 */
import { db } from '@/lib/db';
import { assessReliability, type ReliabilityTier } from './stat-reliability';

export type MarketRegime = 'TRENDING_HIGH_VOL' | 'TRENDING_LOW_VOL' | 'RANGING_HIGH_VOL' | 'RANGING_LOW_VOL';

export function classifyMarketRegime(adx: number, atrPct: number, atrPctMedianRef: number = 1.5): MarketRegime {
  const trending = adx >= 25;
  const highVol = atrPct >= atrPctMedianRef;
  if (trending && highVol) return 'TRENDING_HIGH_VOL';
  if (trending && !highVol) return 'TRENDING_LOW_VOL';
  if (!trending && highVol) return 'RANGING_HIGH_VOL';
  return 'RANGING_LOW_VOL';
}

export interface RegimeStats {
  key: string;
  totalTrades: number;
  wins: number;
  winRate: number;
  avgPnl: number;
  lowConfidence: boolean; // too few real samples to be statistically meaningful yet
  // Statistical-reliability additions — a raw win rate from a handful of
  // same-day (correlated) trades overstates confidence. effectiveN counts
  // unique trading days rather than raw trade count; winRateCI is the
  // Wilson interval on that effective N (wider = more honest at small N).
  effectiveN: number;
  winRateCI: { lower: number; upper: number };
  reliabilityTier: ReliabilityTier;
}

function toStats(key: string, s: { count: number; wins: number; totalPnl: number; entryDates: Date[] }, minSampleSize: number): RegimeStats {
  const reliability = assessReliability(s.wins, s.entryDates);
  return {
    key,
    totalTrades: s.count,
    wins: s.wins,
    winRate: s.count > 0 ? Math.round((s.wins / s.count) * 1000) / 10 : 0,
    avgPnl: s.count > 0 ? Math.round((s.totalPnl / s.count) * 100) / 100 : 0,
    lowConfidence: s.count < minSampleSize,
    effectiveN: reliability.effectiveN,
    winRateCI: { lower: reliability.effectiveWinRate.lower, upper: reliability.effectiveWinRate.upper },
    reliabilityTier: reliability.tier,
  };
}

/**
 * Real conditional win rate by regime, computed from actual closed trades'
 * `tags` field (stamped with `regime-XXX` at entry time). Per the user's own
 * framing: ask "how often has this setup won under similar conditions?",
 * not "did it win last time?" — regimes with fewer than `minSampleSize` real
 * trades are flagged low-confidence rather than presented as reliable.
 */
export async function getWinRateByRegime(minSampleSize: number = 15): Promise<RegimeStats[]> {
  const closed = await db.paperTrade.findMany({
    where: { status: 'CLOSED', autoTraded: true, tags: { contains: 'regime-' } },
  });

  const byRegime = new Map<string, { count: number; wins: number; totalPnl: number; entryDates: Date[] }>();
  for (const t of closed) {
    const match = t.tags?.match(/regime-([A-Z_]+)/);
    if (!match) continue;
    const regime = match[1];
    const bucket = byRegime.get(regime) || { count: 0, wins: 0, totalPnl: 0, entryDates: [] };
    bucket.count++;
    const pnl = t.netPnl ?? t.pnl ?? 0;
    if (pnl > 0) bucket.wins++;
    bucket.totalPnl += pnl;
    bucket.entryDates.push(t.entryDate);
    byRegime.set(regime, bucket);
  }

  return Array.from(byRegime.entries()).map(([regime, s]) => toStats(regime, s, minSampleSize));
}

/** Real win rate by day-of-week and IST time-of-day bucket, from actual entryDate timestamps. */
export async function getWinRateByTimeContext(minSampleSize: number = 15): Promise<{
  byDayOfWeek: RegimeStats[];
  byTimeOfDay: RegimeStats[];
}> {
  const closed = await db.paperTrade.findMany({ where: { status: 'CLOSED', autoTraded: true } });

  const dayBuckets = new Map<string, { count: number; wins: number; totalPnl: number; entryDates: Date[] }>();
  const timeBuckets = new Map<string, { count: number; wins: number; totalPnl: number; entryDates: Date[] }>();
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (const t of closed) {
    const d = new Date(t.entryDate);
    const istMs = d.getTime() + 5.5 * 3600_000 + d.getTimezoneOffset() * 60_000;
    const ist = new Date(istMs);
    const dow = DAYS[ist.getDay()];
    const istHour = ist.getHours();
    const timeBucket = istHour < 11 ? 'Morning (9:15-11:00)' : istHour < 13 ? 'Midday (11:00-13:00)' : 'Afternoon (13:00-15:30)';
    const pnl = t.netPnl ?? t.pnl ?? 0;

    const d1 = dayBuckets.get(dow) || { count: 0, wins: 0, totalPnl: 0, entryDates: [] };
    d1.count++; if (pnl > 0) d1.wins++; d1.totalPnl += pnl; d1.entryDates.push(t.entryDate);
    dayBuckets.set(dow, d1);

    const t1 = timeBuckets.get(timeBucket) || { count: 0, wins: 0, totalPnl: 0, entryDates: [] };
    t1.count++; if (pnl > 0) t1.wins++; t1.totalPnl += pnl; t1.entryDates.push(t.entryDate);
    timeBuckets.set(timeBucket, t1);
  }

  return {
    byDayOfWeek: Array.from(dayBuckets.entries()).map(([k, s]) => toStats(k, s, minSampleSize)),
    byTimeOfDay: Array.from(timeBuckets.entries()).map(([k, s]) => toStats(k, s, minSampleSize)),
  };
}
