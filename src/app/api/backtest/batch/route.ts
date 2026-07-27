/**
 * Top 7 Portfolio Batch Backtest API
 * Runs 5-year historical backtests specifically across the Top 7 Stock Leaders:
 * TATAELXSI (25%), DEEPAKNTR (20%), ADANIENT (16%), TATAPOWER (13%), HINDCOPPER (11%), VEDL (9%), SUZLON (6%)
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  runBacktest, runPortfolioBacktest, DEFAULT_CONFIG, DEFAULT_PORTFOLIO_RULES,
  TOP_7_RANKED_SYMBOLS, type ScreeningConfig, type StockRankWeight, type OHLCV,
} from '@/lib/trading/screening-engine';
import { getHistoricalData } from '@/lib/trading/data-provider';
import { getActiveTop7, getActiveVacantSlots } from '@/lib/trading/rs-ranking';
import { SWING_PROVEN_SYMBOLS } from '@/lib/trading/swing-proven-symbols';

// Real weekly-computed ranking (rs-ranking.ts), falling back to the static
// TOP_7_RANKED_SYMBOLS list only if no dynamic ranking has been computed
// yet — same fallback pattern already used by auto-trade/route.ts and
// screener/route.ts. Previously this endpoint used the hardcoded static
// list unconditionally, meaning "Top 7 Portfolio Backtest" was silently
// testing whichever 7 stocks happened to be hardcoded at some earlier point
// in this file's history, not the system's actual current picks — verified
// live on 2026-07-27: the static list (TATAELXSI, DEEPAKNTR, ADANIENT...)
// and the real active ranking (KALYANKJIL, LAURUSLABS, THYROCARE...) shared
// zero symbols in common that day.
//
// [FIX 2026-07-27] Still wasn't testing what live actually trades: this
// used the raw rank-based Top 7 with no reference to SWING_PROVEN_SYMBOLS,
// the real 5-year-backtest-proven gate auto-trade/route.ts's live scanner
// already applies (pendingCandidates = extended pool ∩ proven set, filled
// in rank-priority order). Verified live: of the raw Top 7 on 2026-07-27
// (KALYANKJIL, LAURUSLABS, THYROCARE, LODHA, GABRIEL, WELCORP, EXIDEIND),
// only 4 are actually on the proven list — LAURUSLABS/WELCORP/EXIDEIND
// would be filtered out and replaced by lower-ranked-but-proven names in
// real live trading, so this endpoint was backtesting a basket that could
// never actually get traded. Now builds the SAME extended pool (top 7 +
// vacant-slot candidates, ~20 stocks) filtered to the proven set —
// runPortfolioBacktest() already fills slots in rank-priority order
// (screening-engine.ts:968), so feeding it this pool reproduces live's real
// fill behavior instead of a fixed 7-name basket.
async function getPortfolioUniverse(): Promise<StockRankWeight[]> {
  const activeTop7 = await getActiveTop7();
  const activeVacant = await getActiveVacantSlots();
  const extendedPool = activeTop7.length > 0 ? [...activeTop7, ...activeVacant] : TOP_7_RANKED_SYMBOLS;
  const proven = extendedPool.filter((s) => SWING_PROVEN_SYMBOLS.has(s.symbol.toUpperCase()));
  return proven.length > 0 ? proven : extendedPool;
}

// Lets the frontend (backtest-tab.tsx) show the SAME symbols this endpoint
// will actually test, instead of importing the static list directly and
// potentially diverging from what POST actually runs.
export async function GET() {
  try {
    const universe = await getPortfolioUniverse();
    return NextResponse.json({ success: true, symbols: universe });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const config: ScreeningConfig = { ...DEFAULT_CONFIG, ...body.config, engineMode: 'SWING' };
    const days = body.days || 1825; // 5 full years up to 2026
    const portfolioUniverse = await getPortfolioUniverse();

    const results: Array<{
      rank: number;
      symbol: string;
      name: string;
      weightPct: number;
      totalTrades: number;
      winRate: number;
      profitFactor: number;
      maxDrawdown: number;
      finalCapital: number;
    }> = [];
    const failed: Array<{ symbol: string; error: string }> = [];

    let totalPortfolioPnl = 0;
    const candlesBySymbol: Record<string, OHLCV[]> = {};

    for (const item of portfolioUniverse) {
      try {
        const { data: candles } = await getHistoricalData(item.symbol, days);
        candlesBySymbol[item.symbol] = candles; // reused below for the joint portfolio simulation
        const res = runBacktest(item.symbol, candles, config);

        const allocatedCapital = config.liveCapital * item.weightPct;
        const stockNetPnl = res.trades.reduce((a, b) => a + b.pnl, 0);
        const stockFinalCap = Math.round(allocatedCapital + stockNetPnl);
        totalPortfolioPnl += stockNetPnl;

        // Report the REAL computed stats, even when they're 0 (0 trades is a
        // valid, meaningful result — not a signal to substitute a plausible-
        // looking invented number in its place).
        results.push({
          rank: item.rank,
          symbol: item.symbol,
          name: item.name,
          weightPct: Math.round(item.weightPct * 100),
          totalTrades: res.stats.totalTrades,
          winRate: res.stats.winRate,
          profitFactor: res.stats.profitFactor,
          maxDrawdown: res.stats.maxDrawdown,
          finalCapital: stockFinalCap
        });
      } catch (err) {
        // Real failure (data fetch or backtest error) — surface it as an
        // error, don't fabricate a plausible-looking result set in its place.
        failed.push({ symbol: item.symbol, error: err instanceof Error ? err.message : String(err) });
      }
    }

    const portfolioFinalCapital = Math.round(config.liveCapital + totalPortfolioPnl);
    const portfolioRoiPct = Math.round(((portfolioFinalCapital - config.liveCapital) / config.liveCapital) * 1000) / 10;
    const avgWinRate = results.length ? Math.round((results.reduce((a, b) => a + b.winRate, 0) / results.length) * 10) / 10 : 0;
    const avgProfitFactor = results.length ? Math.round((results.reduce((a, b) => a + b.profitFactor, 0) / results.length) * 100) / 100 : 0;
    const avgMaxDD = results.length ? Math.round((results.reduce((a, b) => a + b.maxDrawdown, 0) / results.length) * 10) / 10 : 0;

    // Real joint portfolio simulation — all symbols share ONE capital pool
    // day-by-day with maxTotalPositions/drawdown/daily-loss ACTUALLY enforced
    // together, unlike the per-symbol-independent-then-summed numbers above.
    // Kept as a SEPARATE field rather than replacing `aggregated` — both are
    // useful: the independent-sum view shows each symbol's own quality in
    // isolation, this shows what actually happens when they compete for the
    // same limited capital and slots.
    let portfolioSimulation: any = null;
    try {
      let niftyCandles: OHLCV[] | undefined;
      try {
        niftyCandles = (await getHistoricalData('NIFTY50', days + 50)).data;
      } catch { /* regime filter simply won't apply without it, same convention as the single-symbol backtest */ }

      const sim = runPortfolioBacktest(portfolioUniverse, candlesBySymbol, config, niftyCandles, DEFAULT_PORTFOLIO_RULES);
      portfolioSimulation = {
        stats: sim.stats,
        rejections: sim.rejections,
        rules: DEFAULT_PORTFOLIO_RULES,
      };
    } catch (err) {
      portfolioSimulation = { error: err instanceof Error ? err.message : String(err) };
    }

    return NextResponse.json({
      success: true,
      meta: {
        totalUniverse: portfolioUniverse.length,
        successful: results.length,
        failed: failed.length,
        daysTested: days
      },
      aggregated: {
        portfolioFinalCapital,
        portfolioRoiPct,
        avgWinRate,
        avgProfitFactor,
        avgMaxDrawdown: avgMaxDD
      },
      portfolioSimulation,
      ranked: results,
      errors: failed.length > 0 ? failed : undefined,
    });
  } catch (error) {
    console.error('Batch backtest API error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
