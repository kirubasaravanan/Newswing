/**
 * Real Weekly Relative-Strength Ranking Engine
 *
 * Replaces the previously static/hardcoded TOP_7_RANKED_SYMBOLS list in
 * screening-engine.ts, which had permanently fixed rank/weight/performance
 * text ("Highest RS 98 vs Nifty 500...") that never actually reflected any
 * computed relative strength.
 *
 * Every Monday (plus once on first boot, so the system isn't idle on an
 * empty ranking until the next Monday), this scans the full NSE universe,
 * narrows to liquid/trending candidates via the existing L1 filter, and
 * ranks them by a blended real relative-strength score vs. Nifty 50 —
 * computed entirely from real historical price data.
 *
 * Benchmark note: Nifty 50 is used rather than Nifty 500 (which the old
 * static list's comments referenced) because Nifty 50 is already a reliable,
 * always-fetched data source in this codebase (used for the regime filter
 * elsewhere) — there is no existing Nifty 500 index data source to compare
 * against honestly.
 */
import { db } from '@/lib/db';
import { getHistoricalData } from './data-provider';
import { getFullUniverse, runL1Filter } from './universe-scanner';
import type { OHLCV } from './screening-engine';

const TOP_N = 7;
// Widened from 3 to 13 (top-20 total pool) — capacity-based slot-filling in
// auto-trade/route.ts now draws from this wider ranked pool instead of
// strictly requiring the exact Top-7 identities to have a signal today. A
// rank-8..20 stock is often only marginally weaker on RS than rank 1-7, and
// letting it fill an otherwise-vacant slot beats leaving capital idle for a
// day just because the #1-7 names had no valid technical setup.
const VACANT_SLOTS = 13;

// Rank-based capital weighting curve — front-loaded to the strongest
// performer. Same shape as the previous hardcoded per-symbol weights, but
// now applied by computed RANK POSITION rather than tied to specific
// symbols, so it stays meaningful as the underlying symbols rotate weekly.
const RANK_WEIGHTS = [0.25, 0.20, 0.16, 0.13, 0.11, 0.09, 0.06];
// Ranks 8-10 keep the original hand-tuned values; 11-20 decay smoothly. All
// of these stay well under rules.maxPerStock's flat ceiling in practice, so
// the exact curve shape past rank ~10 is not capital-critical.
const VACANT_WEIGHTS = [0.07, 0.05, 0.04, 0.035, 0.032, 0.03, 0.028, 0.026, 0.024, 0.022, 0.02, 0.018, 0.016];

function pctReturn(candles: OHLCV[], lookback: number): number | null {
  const n = candles.length;
  if (n <= lookback) return null;
  const curr = candles[n - 1].close;
  const past = candles[n - 1 - lookback].close;
  if (past <= 0) return null;
  return ((curr - past) / past) * 100;
}

interface RSCandidate {
  symbol: string;
  name: string;
  sector: string;
  rsScore: number;
  perf1W: number;
  perf1M: number;
}

let computationInProgress = false;

/**
 * Scan the full NSE universe and (re)compute the real weekly RS ranking.
 * Guarded against re-entrant calls; the caller is additionally responsible
 * for not invoking this more than once per cycle (see route.ts's
 * dispatchWeeklyRebalanceNotice, which checks cycleDate before calling).
 */
export async function computeWeeklyRSRanking(): Promise<{ top7: RSCandidate[]; vacant: RSCandidate[] } | null> {
  if (computationInProgress) return null;
  computationInProgress = true;
  try {
    const universe = getFullUniverse();
    const { data: niftyData } = await getHistoricalData('NIFTY50', 380);
    if (!niftyData || niftyData.length < 64) return null; // can't compute real RS without a real benchmark series

    const niftyRet1W = pctReturn(niftyData, 5) ?? 0;
    const niftyRet1M = pctReturn(niftyData, 21) ?? 0;
    const niftyRet3M = pctReturn(niftyData, 63) ?? 0;

    const candidates: RSCandidate[] = [];
    const BATCH = 15;
    for (let i = 0; i < universe.length; i += BATCH) {
      const batch = universe.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(async (stock) => {
        const { data } = await getHistoricalData(stock.symbol, 380);
        return { stock, data };
      }));
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const { stock, data } = r.value;
        const l1 = runL1Filter(stock.symbol, stock.name, stock.sector, stock.category, data);
        if (!l1 || !l1.passed) continue;

        const ret1W = pctReturn(data, 5);
        const ret1M = pctReturn(data, 21);
        const ret3M = pctReturn(data, 63);
        if (ret1W == null || ret1M == null || ret3M == null) continue;

        // Blended excess-return RS score: weighted toward the more stable
        // 1M/3M windows, with a smaller weight on 1W momentum. All three
        // inputs are real trailing returns vs. Nifty 50's real return over
        // the same window — never an invented or fixed number.
        const rsScore = (ret1W - niftyRet1W) * 0.2 + (ret1M - niftyRet1M) * 0.4 + (ret3M - niftyRet3M) * 0.4;
        candidates.push({ symbol: stock.symbol, name: stock.name, sector: stock.sector, rsScore, perf1W: ret1W, perf1M: ret1M });
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.rsScore - a.rsScore);
    const top7 = candidates.slice(0, TOP_N);
    const vacant = candidates.slice(TOP_N, TOP_N + VACANT_SLOTS);

    const cycleDate = new Date().toISOString().split('T')[0];

    await db.$transaction(async (tx) => {
      await tx.weeklyRanking.updateMany({ where: { isActive: true }, data: { isActive: false } });
      await tx.weeklyRanking.createMany({
        data: [
          ...top7.map((c, i) => ({
            cycleDate, symbol: c.symbol, name: c.name, sector: c.sector,
            rank: i + 1, rsScore: Math.round(c.rsScore * 100) / 100,
            weightPct: RANK_WEIGHTS[i] ?? 0.06,
            perf1W: Math.round(c.perf1W * 100) / 100, perf1M: Math.round(c.perf1M * 100) / 100,
            isTop7: true, isActive: true,
          })),
          ...vacant.map((c, i) => ({
            cycleDate, symbol: c.symbol, name: c.name, sector: c.sector,
            rank: TOP_N + i + 1, rsScore: Math.round(c.rsScore * 100) / 100,
            weightPct: VACANT_WEIGHTS[i] ?? 0.04,
            perf1W: Math.round(c.perf1W * 100) / 100, perf1M: Math.round(c.perf1M * 100) / 100,
            isTop7: false, isActive: true,
          })),
        ],
      });
    });

    return { top7, vacant };
  } finally {
    computationInProgress = false;
  }
}

/** Compute an initial ranking on first boot if none exists yet — otherwise a
 * fresh deployment would sit with an empty watchlist until the next Monday. */
export async function ensureWeeklyRankingBootstrapped(): Promise<void> {
  const count = await db.weeklyRanking.count();
  if (count === 0) {
    await computeWeeklyRSRanking();
  }
}

export interface RankedStock {
  symbol: string;
  name: string;
  rank: number;
  weightPct: number;
  rankReason?: string;
  perf1W?: string;
  perf1M?: string;
  high52W?: string;
  low52W?: string;
}

function toRankedStock(row: { symbol: string; name: string; rank: number; weightPct: number; rsScore: number; perf1W: number; perf1M: number }): RankedStock {
  return {
    symbol: row.symbol,
    name: row.name,
    rank: row.rank,
    weightPct: row.weightPct,
    rankReason: `RS score ${row.rsScore >= 0 ? '+' : ''}${row.rsScore.toFixed(1)} vs Nifty 50 (blended real 1W/1M/3M excess return)`,
    perf1W: `${row.perf1W >= 0 ? '+' : ''}${row.perf1W.toFixed(1)}%`,
    perf1M: `${row.perf1M >= 0 ? '+' : ''}${row.perf1M.toFixed(1)}%`,
  };
}

export async function getActiveTop7(): Promise<RankedStock[]> {
  const rows = await db.weeklyRanking.findMany({ where: { isActive: true, isTop7: true }, orderBy: { rank: 'asc' } });
  return rows.map(toRankedStock);
}

export async function getActiveVacantSlots(): Promise<RankedStock[]> {
  const rows = await db.weeklyRanking.findMany({ where: { isActive: true, isTop7: false }, orderBy: { rank: 'asc' } });
  return rows.map(toRankedStock);
}
