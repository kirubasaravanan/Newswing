import { db } from '@/lib/db';
import {
  OPTIONS_PROVEN_SYMBOLS, OPTIONS_TOP10_SYMBOLS, OPTIONS_TOP5_PRIORITY,
  OPTIONS_PROVEN_METRICS, OPT_TOP10_CONCURRENCY_CAP,
} from '@/lib/trading/options-proven-symbols';

export interface OptionsUniverseRow {
  symbol: string;
  profitFactor: number; totalTrades: number; winRate: number; sharpeRatio: number;
  inTop10: boolean; // currently eligible to trade live
  isPriority: boolean; // TOP-5 — Discord priority tag only, doesn't affect trading
  openPosition?: { direction: string; strike: number; expiry: string; entryPrice: number; qty: number };
}

/**
 * Real options watchlist status — mirrors swing-universe-status.ts. All 20
 * real-backtest-proven options symbols, ranked by PF, each flagged whether
 * it's in the live TOP-10 trading set and/or the TOP-5 Discord-priority
 * subset (see options-proven-symbols.ts for the concurrency backtest this
 * came from), plus whether it currently has an open paper position.
 *
 * Static backtest metrics only — no live option-chain/signal fetch here
 * (that's scanOptionsUniverse()'s job during a real scan), so this is cheap
 * enough to call from the main dashboard poll, unlike swing's version.
 */
export async function getOptionsUniverseStatus(): Promise<OptionsUniverseRow[]> {
  const openOptions = await db.paperTrade.findMany({
    where: { status: 'OPEN', tags: { contains: 'options' } },
    select: { symbol: true, direction: true, entryPrice: true, qty: true },
  });
  const openByUnderlying = new Map<string, typeof openOptions[number]>();
  for (const t of openOptions) {
    const underlying = t.symbol.split('_')[0];
    if (!openByUnderlying.has(underlying)) {
      openByUnderlying.set(underlying, t);
    }
  }

  return Array.from(OPTIONS_PROVEN_SYMBOLS)
    .map(symbol => ({ symbol, metrics: OPTIONS_PROVEN_METRICS[symbol] }))
    .filter((s): s is { symbol: string; metrics: NonNullable<typeof s.metrics> } => !!s.metrics)
    .sort((a, b) => b.metrics.profitFactor - a.metrics.profitFactor)
    .map(({ symbol, metrics }) => {
      const open = openByUnderlying.get(symbol);
      const [, direction, strikeStr, expiry] = open ? open.symbol.split('_') : [];
      return {
        symbol,
        profitFactor: metrics.profitFactor,
        totalTrades: metrics.totalTrades,
        winRate: metrics.winRate,
        sharpeRatio: metrics.sharpeRatio,
        inTop10: OPTIONS_TOP10_SYMBOLS.has(symbol),
        isPriority: OPTIONS_TOP5_PRIORITY.has(symbol),
        openPosition: open ? {
          direction: direction || open.direction,
          strike: Number(strikeStr) || 0,
          expiry: expiry || '',
          entryPrice: open.entryPrice,
          qty: open.qty,
        } : undefined,
      };
    });
}

export { OPT_TOP10_CONCURRENCY_CAP };
