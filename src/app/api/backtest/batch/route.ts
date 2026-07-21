/**
 * Batch Backtest API
 * Runs backtests across top F&O stocks in parallel, aggregates results,
 * and returns ranked performance stats.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runBacktest, DEFAULT_CONFIG, type ScreeningConfig } from '@/lib/trading/screening-engine';
import { getHistoricalData } from '@/lib/trading/data-provider';
import { getFNOUniverse } from '@/lib/trading/options-scanner';

// ── Types ──────────────────────────────────────────────
interface StockResult {
  symbol: string;
  success: boolean;
  stats: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    sharpeRatio: number;
    maxDrawdown: number;
    finalCapital: number;
    cagr: number;
    avgWin: number;
    avgLoss: number;
    bestTrade: number;
    worstTrade: number;
  } | null;
  error?: string;
}

// ── Helpers ────────────────────────────────────────────
async function backtestSingleStock(
  symbol: string,
  config: ScreeningConfig,
  days: number
): Promise<StockResult> {
  try {
    const [stockRes, niftyRes] = await Promise.all([
      getHistoricalData(symbol, days + 50),
      getHistoricalData('NIFTY50', days + 50),
    ]);

    if (!stockRes.data || stockRes.data.length < 250) {
      return { symbol, success: false, stats: null, error: 'Insufficient data' };
    }

    const result = runBacktest(symbol, stockRes.data, niftyRes.data, config);
    const initialCapital = config.liveCapital;
    const finalCapital = result.stats.finalCapital;
    const tradingDays = result.stats.totalTrades > 0 ? Math.max(result.stats.totalTrades * 3, 60) : 60;
    const cagr = ((finalCapital / initialCapital) ** (252 / tradingDays) - 1) * 100;

    return {
      symbol,
      success: true,
      stats: {
        ...result.stats,
        cagr: Math.round(cagr * 100) / 100,
      },
    };
  } catch (err: any) {
    return { symbol, success: false, stats: null, error: String(err?.message || err) };
  }
}

// ── POST: Run batch backtest ────────────────────────────
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const TIMEOUT_MS = 4.5 * 60 * 1000; // 4.5 min safety margin

  try {
    const body = await request.json();
    const config: ScreeningConfig = { ...DEFAULT_CONFIG, ...body.config };
    const days = body.days || 180;
    const maxStocks = Math.min(body.maxStocks || 30, 50);

    // Get F&O universe and pick top stocks
    const universe = getFNOUniverse().filter(s => s !== 'NIFTY' && s !== 'BANKNIFTY' && s !== 'FINNIFTY');
    const topStocks = universe.slice(0, maxStocks);

    if (topStocks.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No F&O stocks found in universe',
      }, { status: 400 });
    }

    // Run in batches of 5 to avoid overwhelming data providers
    const BATCH_SIZE = 5;
    const results: StockResult[] = [];
    let failedCount = 0;

    for (let i = 0; i < topStocks.length; i += BATCH_SIZE) {
      // Check timeout
      if (Date.now() - startTime > TIMEOUT_MS) {
        results.push({
          symbol: 'TIMEOUT', success: false, stats: null,
          error: `Batch timed out after ${Math.round((Date.now() - startTime) / 1000)}s`,
        });
        break;
      }

      const batch = topStocks.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(s => backtestSingleStock(s, config, days))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const r = batchResults[j];
        if (r.status === 'fulfilled') {
          results.push(r.value);
          if (!r.value.success) failedCount++;
        } else {
          failedCount++;
          results.push({
            symbol: batch[j], success: false, stats: null,
            error: String(r.reason?.message || r.reason),
          });
        }
      }
    }

    // Aggregate stats
    const successful = results.filter(r => r.success && r.stats);
    const ranked = successful
      .map(r => ({ symbol: r.symbol, ...r.stats! }))
      .sort((a, b) => (b.sharpeRatio ?? 0) - (a.sharpeRatio ?? 0));

    const avgWinRate = successful.length > 0
      ? successful.reduce((s, r) => s + (r.stats?.winRate ?? 0), 0) / successful.length
      : 0;
    const avgSharpe = successful.length > 0
      ? successful.reduce((s, r) => s + (r.stats?.sharpeRatio ?? 0), 0) / successful.length
      : 0;
    const avgPF = successful.length > 0
      ? successful.reduce((s, r) => s + (r.stats?.profitFactor ?? 0), 0) / successful.length
      : 0;
    const avgCAGR = successful.length > 0
      ? successful.reduce((s, r) => s + (r.stats?.cagr ?? 0), 0) / successful.length
      : 0;
    const avgMaxDD = successful.length > 0
      ? successful.reduce((s, r) => s + (r.stats?.maxDrawdown ?? 0), 0) / successful.length
      : 0;
    const profitableCount = successful.filter(r => (r.stats?.finalCapital ?? 0) > config.liveCapital).length;
    const consistencyScore = successful.length > 0
      ? Math.round((profitableCount / successful.length) * 100)
      : 0;

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    return NextResponse.json({
      success: true,
      meta: {
        totalUniverse: universe.length,
        tested: topStocks.length,
        successful: successful.length,
        failed: failedCount,
        elapsedSec: elapsed,
        days,
      },
      aggregated: {
        avgWinRate: Math.round(avgWinRate * 100) / 100,
        avgSharpe: Math.round(avgSharpe * 100) / 100,
        avgProfitFactor: Math.round(avgPF * 100) / 100,
        avgCAGR: Math.round(avgCAGR * 100) / 100,
        avgMaxDrawdown: Math.round(avgMaxDD * 100) / 100,
        consistencyScore,
        profitableCount,
      },
      ranked,
      allResults: results,
    });
  } catch (error) {
    console.error('Batch backtest error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// ── GET: Return available F&O stock list for batch selection ──
export async function GET() {
  try {
    const universe = getFNOUniverse().filter(
      s => s !== 'NIFTY' && s !== 'BANKNIFTY' && s !== 'FINNIFTY'
    );
    return NextResponse.json({
      success: true,
      stocks: universe.slice(0, 50),
      total: universe.length,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
