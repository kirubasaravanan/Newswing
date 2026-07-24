/**
 * Top 7 Portfolio Batch Backtest API
 * Runs 5-year historical backtests specifically across the Top 7 Stock Leaders:
 * TATAELXSI (25%), DEEPAKNTR (20%), ADANIENT (16%), TATAPOWER (13%), HINDCOPPER (11%), VEDL (9%), SUZLON (6%)
 */
import { NextRequest, NextResponse } from 'next/server';
import { runBacktest, DEFAULT_CONFIG, TOP_7_RANKED_SYMBOLS, type ScreeningConfig } from '@/lib/trading/screening-engine';
import { getHistoricalData } from '@/lib/trading/data-provider';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const config: ScreeningConfig = { ...DEFAULT_CONFIG, ...body.config, engineMode: 'SWING' };
    const days = body.days || 1825; // 5 full years up to 2026

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

    for (const item of TOP_7_RANKED_SYMBOLS) {
      try {
        const { data: candles } = await getHistoricalData(item.symbol, days);
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

    return NextResponse.json({
      success: true,
      meta: {
        totalUniverse: TOP_7_RANKED_SYMBOLS.length,
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
      ranked: results,
      errors: failed.length > 0 ? failed : undefined,
    });
  } catch (error) {
    console.error('Batch backtest API error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
