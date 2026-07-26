import { runScreening, DEFAULT_CONFIG } from '@/lib/trading/screening-engine';
import { getHistoricalData, getCurrentPrice } from '@/lib/trading/data-provider';
import { getFullUniverse } from '@/lib/trading/universe-scanner';
import { getActiveTop7, getActiveVacantSlots } from '@/lib/trading/rs-ranking';
import { SWING_PROVEN_SYMBOLS, SWING_PROVEN_METRICS } from '@/lib/trading/swing-proven-symbols';
import { db } from '@/lib/db';

export interface SwingUniverseRow {
  symbol: string; name: string; sector: string;
  profitFactor: number; totalTrades: number; winRate: number; sharpeRatio: number;
  currentlyRsRanked: boolean; rank: number | null; weightPct: number | null;
  currentPrice: number; aligned: boolean; missing: string[];
  openPosition?: { entryPrice: number; qty: number; pnl: number; pnlPct: number };
}

/**
 * Every one of the 74 real-backtest-proven swing symbols
 * (swing-proven-symbols.ts), ranked by real backtest profitFactor (not live
 * RS rank). Live trading eligibility in autoScanAndTrade (auto-trade/route.ts)
 * is actually the INTERSECTION of this 74-symbol proven set with the live RS
 * top-20 pool, so each row also shows whether it's currently in that live RS
 * pool (currentlyRsRanked/rank/weightPct — null when it isn't this week) —
 * this tells you not just "is this a good stock" but "is it actually
 * eligible to trade right now": a proven-but-not-currently-RS-ranked stock
 * is pending on RS rank, not on its own setup; one that IS RS-ranked but not
 * `aligned` is pending on `missing`.
 *
 * Deliberately its own on-demand endpoint (see
 * src/app/api/auto-trade/swing-universe/route.ts), not folded into the main
 * auto-trade GET handler, which polls every few seconds — scanning 74
 * symbols' historical data + live price on every poll would be far too
 * expensive. Call this only when the user actually opens this view.
 */
// Historical-data + live-price fetches run this many at a time. Sequential
// (one at a time, awaited in a loop) was the original bug here — 74 symbols
// awaited one by one made this endpoint appear to hang indefinitely. Same
// batch size rs-ranking.ts already uses for its own full-universe scan.
const BATCH = 15;

export async function getSwingUniverseStatus(): Promise<SwingUniverseRow[]> {
  try {
    const activeTop7 = await getActiveTop7();
    const activeVacant = await getActiveVacantSlots();
    const dynamicRankTable = [...activeTop7, ...activeVacant];
    const rsBySymbol = new Map(dynamicRankTable.map(s => [s.symbol.toUpperCase(), s]));
    const nameBySymbol = new Map(getFullUniverse().map(s => [s.symbol.toUpperCase(), s.name]));

    const provenRanked = Array.from(SWING_PROVEN_SYMBOLS)
      .map(symbol => ({ symbol, metrics: SWING_PROVEN_METRICS[symbol] }))
      .filter((s): s is { symbol: string; metrics: NonNullable<typeof s.metrics> } => !!s.metrics)
      .sort((a, b) => b.metrics.profitFactor - a.metrics.profitFactor);

    let niftyData: any[] = [];
    try {
      niftyData = (await getHistoricalData('NIFTY50', 350)).data;
    } catch { /* RS check below will simply stay unproven without Nifty data */ }

    // One query for every open auto-trade instead of 74 separate ones.
    const openTrades = await db.paperTrade.findMany({
      where: { symbol: { in: provenRanked.map(p => p.symbol) }, status: 'OPEN', autoTraded: true },
    });
    const openBySymbol = new Map(openTrades.map(t => [t.symbol, t]));

    const results: SwingUniverseRow[] = [];
    for (let i = 0; i < provenRanked.length; i += BATCH) {
      const batch = provenRanked.slice(i, i + BATCH);
      const batchResults = await Promise.allSettled(batch.map(async ({ symbol, metrics }) => {
        const [{ data }, { price }] = await Promise.all([
          getHistoricalData(symbol, 300),
          getCurrentPrice(symbol),
        ]);
        const rsRow = rsBySymbol.get(symbol.toUpperCase());
        // includeUnmet=true so we get the signal even if not all conditions met
        const signal = runScreening(symbol, data, DEFAULT_CONFIG, true, true, niftyData, dynamicRankTable);

        const aligned = signal
          ? signal.checks.trendAbove && signal.checks.pullbackOk && signal.checks.triggerOk && signal.checks.volumeOk
          : false;
        const missing = signal?.missingConditions || ['No data'];
        const openTrade = openBySymbol.get(symbol);

        const row: SwingUniverseRow = {
          symbol,
          name: rsRow?.name || nameBySymbol.get(symbol) || symbol,
          sector: metrics.sector,
          profitFactor: metrics.profitFactor,
          totalTrades: metrics.totalTrades,
          winRate: metrics.winRate,
          sharpeRatio: metrics.sharpeRatio,
          currentlyRsRanked: !!rsRow,
          rank: rsRow?.rank ?? null,
          weightPct: rsRow?.weightPct ?? null,
          currentPrice: Math.round(price * 100) / 100,
          aligned,
          missing, // full list, not truncated — this is the "what is pending" detail
          openPosition: openTrade ? {
            entryPrice: openTrade.entryPrice,
            qty: openTrade.qty,
            pnl: Math.round((price - openTrade.entryPrice) * openTrade.qty * 100) / 100,
            pnlPct: Math.round(((price - openTrade.entryPrice) / openTrade.entryPrice) * 10000) / 100,
          } : undefined,
        };
        return row;
      }));
      for (const r of batchResults) {
        if (r.status === 'fulfilled') results.push(r.value);
      }
    }
    return results;
  } catch {
    return [];
  }
}
